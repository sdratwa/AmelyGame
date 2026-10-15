import { describe, expect, it } from "vitest";
import { ITEMS } from "../content/items";
import { RIDDLE_BY_ID, RIDDLES } from "../content/riddles";
import { QUESTS } from "../content/quests";
import { applyCommand, type Command } from "../core/apply";
import { SECONDS_PER_DAY, SECONDS_PER_GAME_HOUR } from "../core/constants";
import { nextDayStart } from "../core/clock";
import type { GameEvent } from "../core/events";
import { isTimePaused, pauseReasons } from "../core/pause";
import type { GameState } from "../core/state";
import { hydrateState } from "../save/hydrate";
import { serializeState } from "../save/serialize";
import { validateSaveV2 } from "../save/validate";
import { anchorsOf, autoComplete, harvestTarget, harvestTargets, inForest, near, newPlaying, run } from "../testkit";
import { countOf, inventoryProblems } from "./containers";
import { riddleFor } from "./forestQuest";
import { forestOf } from "../world/lookup";
import { boardHasUnread, questProgress } from "./quests";

const BRIDGE = "quest.bridge_01" as const;

/** Gra z automatyczną kontrolą niezmienników i zapisu po KAŻDEJ komendzie. */
class Game {
  state: GameState;
  events: GameEvent[] = [];
  readonly seed: number;
  constructor(seed = 777) {
    this.seed = seed;
    this.state = inForest(newPlaying(seed));
  }
  forest() {
    this.state = inForest(this.state);
  }
  do(command: Command): GameEvent[] {
    const out = applyCommand(this.state, command);
    this.state = out.state;
    this.events.push(...out.events);
    this.check();
    return out.events;
  }
  check() {
    const s = this.state;
    expect(inventoryProblems(s.slots, s.troll.deposit, s.ledger)).toEqual([]);
    const save = serializeState(s, 1)!;
    const valid = validateSaveV2(JSON.parse(JSON.stringify(save)));
    expect(valid.ok ? [] : valid.problems).toEqual([]);
    expect(serializeState(hydrateState(save), 1)).toEqual(save);
  }
  /** Zapis i ponowne wczytanie gry (jak zamknięcie i otwarcie karty). */
  reload() {
    const save = JSON.parse(JSON.stringify(serializeState(this.state, 1)));
    const valid = validateSaveV2(save);
    if (!valid.ok) throw new Error(valid.problems.join("; "));
    this.state = hydrateState(valid.value);
    this.check();
    this.forest();
  }
  get a() {
    return anchorsOf(this.state);
  }
  chest(id: string) {
    return (this.a.chests as Record<string, { x: number; z: number }>)[id];
  }
  has(id: Parameters<typeof countOf>[1]) {
    return countOf(this.state.slots, id);
  }
  /** Przesunięcie zegara gry (z uzupełnieniem zdrowia, żeby test nie zależał od drenażu). */
  advanceTo(t: number) {
    this.state = inForest({ ...this.state, elapsed: Math.max(this.state.elapsed, t), health: 100 });
  }
  openAndTake(id: "chest.bridge.pickaxe" | "chest.bridge.saw" | "chest.bridge.blueprint") {
    this.do({ type: "chest.open", id, at: near(this.chest(id)) });
    this.do({ type: "chest.take", id, at: near(this.chest(id)) });
  }
  /** Dziesięć kamieni z pięciu średnich skał (duże skały są rzadkie, więc nie liczymy na nie). */
  stone10(from = 0) {
    for (let i = 0; i < 5; i++) this.harvest("rock", "m", from + i);
  }
  harvest(kind: "tree" | "rock", size: "s" | "m" | "l", n: number) {
    const target = harvestTarget(this.seed, kind, size, n);
    this.do({ type: "harvest", objectId: target.id, at: target.at });
  }
}

const eventTypes = (events: GameEvent[]) => events.map((e) => e.type).filter((t) => t !== "time.pause_changed");

describe("Q1: tablica i przyjęcie zadania", () => {
  it("wykrzyknik jest do przeczytania ogłoszenia; przeczytane to nie przyjęte; zapowiedzi są niedostępne", () => {
    const g = new Game();
    expect(boardHasUnread(g.state)).toBe(true);
    expect(questProgress(g.state, BRIDGE)!.status).toBe("available");
    expect(questProgress(g.state, "quest.preview_orchard")!.status).toBe("unavailable");
    g.do({ type: "board.read", id: BRIDGE });
    expect(boardHasUnread(g.state)).toBe(false);
    expect(questProgress(g.state, BRIDGE)!.status).toBe("available");
    g.do({ type: "quest.accept", id: "quest.preview_lantern" });
    expect(g.state.quests.accepted).toEqual({});
    g.do({ type: "quest.accept", id: BRIDGE });
    expect(questProgress(g.state, BRIDGE)!.status).toBe("active");
    g.reload();
    expect(questProgress(g.state, BRIDGE)!.status).toBe("active");
    expect(boardHasUnread(g.state)).toBe(false);
  });

  it("zadanie nie przyjmuje się dwa razy ani po śmierci gracza", () => {
    const g = new Game();
    g.do({ type: "quest.accept", id: BRIDGE });
    const before = g.state;
    expect(applyCommand(before, { type: "quest.accept", id: BRIDGE }).state).toBe(before);
    const dead = { ...newPlaying(5), dead: true, health: 0 };
    expect(applyCommand(dead, { type: "quest.accept", id: BRIDGE }).state).toBe(dead);
  });

  it("zawartość zadania jest danymi: 5 etapów, nagroda 5000 zł i odznaka, zapowiedzi bez celów", () => {
    const def = QUESTS.find((q) => q.id === BRIDGE)!;
    expect(def.stages.map((s) => s.id)).toEqual(["tools", "blueprint", "materials", "build", "cross"]);
    expect(def.reward).toEqual({ money: 5000, badge: "badge.explorer" });
    expect(QUESTS.filter((q) => q.preview)).toHaveLength(2);
  });
});

describe("Q1: skrzynie", () => {
  it("otwarcie jest oddzielone od odebrania; z daleka i bez zadania nie da się otworzyć obcej skrzyni", () => {
    const g = new Game();
    const id = "chest.bridge.pickaxe";
    const far = { x: g.chest(id).x + 50, z: g.chest(id).z };
    expect(g.do({ type: "chest.open", id, at: far })).toEqual([]);
    expect(g.do({ type: "chest.take", id, at: near(g.chest(id)) })).toEqual([]);
    expect(eventTypes(g.do({ type: "chest.open", id, at: near(g.chest(id)) }))).toEqual(["chest.opened"]);
    expect(g.has("item.pickaxe")).toBe(0);
    expect(g.state.chests[id]).toEqual({ opened: true, taken: false });
    g.reload();
    expect(eventTypes(g.do({ type: "chest.take", id, at: near(g.chest(id)) }))).toEqual(["chest.taken"]);
    expect(g.has("item.pickaxe")).toBe(1);
    expect(g.do({ type: "chest.take", id, at: near(g.chest(id)) })).toEqual([]);
    expect(g.state.ledger.gained["item.pickaxe"]).toBe(1);
  });

  it("pełny ekwipunek zostawia przedmiot w skrzyni, a po zrobieniu miejsca można go odebrać", () => {
    const g = new Game();
    for (let i = 0; i < 7; i++) g.do({ type: "buy", item: "item.water" });
    const id = "chest.bridge.saw";
    g.do({ type: "chest.open", id, at: near(g.chest(id)) });
    const ev = g.do({ type: "chest.take", id, at: near(g.chest(id)) });
    expect(eventTypes(ev)).toEqual(["chest.take_failed"]);
    expect(g.state.chests[id]).toEqual({ opened: true, taken: false });
    g.do({ type: "discard", slot: 3 });
    g.do({ type: "chest.take", id, at: near(g.chest(id)) });
    expect(g.has("item.saw")).toBe(1);
  });

  it("skrzynia ze schematem jest pilnowana przez trolla do rozwiązania zagadki", () => {
    const g = new Game();
    const id = "chest.bridge.blueprint";
    expect(eventTypes(g.do({ type: "chest.open", id, at: near(g.chest(id)) }))).toEqual(["chest.open_failed"]);
    expect(g.state.chests[id]).toBeUndefined();
    const troll = g.a.troll;
    expect(Math.hypot(troll.x - g.chest(id).x, troll.z - g.chest(id).z)).toBeLessThan(6);
  });
});

describe("Q1: troll, konfiskata i depozyt", () => {
  function confiscated(): Game {
    const g = new Game();
    g.do({ type: "quest.accept", id: BRIDGE });
    g.do({ type: "buy", item: "item.hotdog" });
    g.openAndTake("chest.bridge.pickaxe");
    g.openAndTake("chest.bridge.saw");
    g.do({ type: "enter", view: "forest" });
    g.do({ type: "troll.talk", at: near(g.a.troll) });
    g.do({ type: "troll.choose", choice: "fight" });
    return g;
  }

  it("pierwsza nieudana konfrontacja zabiera wszystko poza telefonem, nie rusza pieniędzy i odsyła do miasta", () => {
    const g = new Game();
    g.openAndTake("chest.bridge.pickaxe");
    g.do({ type: "buy", item: "item.coffee" });
    const wallet = g.state.wallet;
    g.do({ type: "enter", view: "forest" });
    g.do({ type: "troll.talk", at: near(g.a.troll) });
    expect(g.state.dialog?.stage).toBe("intro");
    const ev = g.do({ type: "troll.choose", choice: "fight" });
    expect(eventTypes(ev)).toContain("troll.confiscated");
    expect(g.state.slots.filter(Boolean)).toEqual([{ id: "item.phone", count: 1 }]);
    expect(g.state.wallet).toBe(wallet);
    expect(g.state.view).toBe("world");
    expect(g.state.dialog).toBeNull();
    expect(g.state.forestPose).toBeNull();
    expect(g.state.troll.deposit).toEqual(
      expect.arrayContaining([
        { id: "item.pickaxe", count: 1 },
        { id: "item.coffee", count: 1 },
      ]),
    );
    expect(g.state.troll.phase).toBe("confronted");
    g.reload();
    expect(g.state.troll.deposit).toHaveLength(2);
    expect(g.state.slots[0]).toEqual({ id: "item.phone", count: 1 });
  });

  it("ponowna próba dopiero następnego dnia gry, a cel odzyskania pojawia się w zadaniu", () => {
    const g = confiscated();
    g.do({ type: "quest.accept", id: BRIDGE });
    const lock = g.state.troll.lockUntil;
    expect(lock).toBe(nextDayStart(g.state.elapsed));
    expect(lock - g.state.elapsed).toBeGreaterThan(0);
    g.advanceTo(g.state.elapsed + SECONDS_PER_GAME_HOUR); // godzina nie wystarcza
    expect(eventTypes(g.do({ type: "troll.talk", at: near(g.a.troll) }))).toEqual(["troll.locked"]);
    const progress = questProgress(g.state, BRIDGE)!;
    const recover = progress.stages[1].objectives.find((o) => o.id === "recover")!;
    expect(recover.visible).toBe(true);
    expect(recover.done).toBe(false);
    // narzędzia policzone jako "znalezione" mimo konfiskaty (cele monotoniczne)
    expect(progress.stages[0].done).toBe(true);
    g.advanceTo(lock);
    expect(eventTypes(g.do({ type: "troll.talk", at: near(g.a.troll) }))).toEqual(["troll.dialog_opened"]);
    expect(g.state.dialog?.stage).toBe("riddle");
    expect(g.state.troll.lockUntil).toBe(lock);
  });

  it("po konfrontacji troll nie oferuje już walki: tylko zagadki", () => {
    const g = confiscated();
    g.advanceTo(g.state.troll.lockUntil);
    g.do({ type: "troll.talk", at: near(g.a.troll) });
    const before = g.state;
    expect(applyCommand(before, { type: "troll.choose", choice: "fight" }).state).toBe(before);
    expect(g.state.troll.deposit.length).toBeGreaterThan(0);
  });

  it("dobra odpowiedź zwraca depozyt, otwiera skrzynię ze schematem i nie duplikuje przedmiotów", () => {
    const g = confiscated();
    const held = g.state.ledger.gained;
    g.advanceTo(g.state.troll.lockUntil);
    g.do({ type: "troll.talk", at: near(g.a.troll) });
    const riddle = RIDDLE_BY_ID.get(g.state.dialog!.riddle!)!;
    const ev = g.do({ type: "riddle.answer", value: riddle.answer });
    expect(eventTypes(ev)).toEqual(["troll.riddle_answered", "troll.deposit_recovered"]);
    expect(g.state.troll.phase).toBe("solved");
    expect(g.state.troll.deposit).toEqual([]);
    expect(g.has("item.pickaxe")).toBe(1);
    expect(g.has("item.saw")).toBe(1);
    expect(g.has("item.hotdog")).toBe(1);
    expect(g.state.ledger.gained).toEqual(held);
    g.reload();
    g.openAndTake("chest.bridge.blueprint");
    expect(g.has("item.bridge_blueprint")).toBe(1);
  });

  it("błędna odpowiedź blokuje troll na godzinę gry (nie na dzień) i daje kolejną zagadkę", () => {
    const g = confiscated();
    g.advanceTo(g.state.troll.lockUntil);
    g.do({ type: "troll.talk", at: near(g.a.troll) });
    const first = g.state.dialog!.riddle;
    const t0 = g.state.elapsed;
    g.do({ type: "riddle.answer", value: RIDDLE_BY_ID.get(first!)!.answer + 1 });
    expect(g.state.dialog).toBeNull();
    expect(g.state.troll.lockUntil).toBe(t0 + SECONDS_PER_GAME_HOUR);
    expect(g.state.troll.phase).toBe("confronted");
    expect(g.state.troll.deposit.length).toBeGreaterThan(0);
    expect(eventTypes(g.do({ type: "troll.talk", at: near(g.a.troll) }))).toEqual(["troll.locked"]);
    g.advanceTo(t0 + SECONDS_PER_GAME_HOUR);
    g.do({ type: "troll.talk", at: near(g.a.troll) });
    expect(g.state.dialog!.riddle).not.toBe(first);
  });

  it("zamknięcie rozmowy bez odpowiedzi nie zużywa próby i nie blokuje trolla", () => {
    const g = confiscated();
    g.advanceTo(g.state.troll.lockUntil);
    g.do({ type: "troll.talk", at: near(g.a.troll) });
    const riddle = g.state.dialog!.riddle;
    g.do({ type: "dialog.close" });
    expect(g.state.troll.attempts).toBe(0);
    g.do({ type: "troll.talk", at: near(g.a.troll) });
    expect(g.state.dialog!.riddle).toBe(riddle);
  });

  it("rozmowa przed konfrontacją (negocjacje) pozwala rozwiązać zagadkę bez utraty rzeczy", () => {
    const g = new Game();
    g.openAndTake("chest.bridge.pickaxe");
    g.do({ type: "troll.talk", at: near(g.a.troll) });
    g.do({ type: "troll.choose", choice: "talk" });
    g.do({ type: "riddle.answer", value: RIDDLE_BY_ID.get(g.state.dialog!.riddle!)!.answer });
    expect(g.state.troll.phase).toBe("solved");
    expect(g.has("item.pickaxe")).toBe(1);
    expect(g.state.troll.deposit).toEqual([]);
    g.do({ type: "troll.talk", at: near(g.a.troll) });
    expect(g.state.dialog).toBeNull();
  });

  it("zagadki: co najmniej 10, poprawne odpowiedzi, stabilny wybór dla zapisu i różne kolejne próby", () => {
    expect(RIDDLES.length).toBeGreaterThanOrEqual(10);
    expect(new Set(RIDDLES.map((r) => r.id)).size).toBe(RIDDLES.length);
    expect(riddleFor(777, 0)).toBe(riddleFor(777, 0));
    const seen = new Set(RIDDLES.map((_, i) => riddleFor(777, i).id));
    expect(seen.size).toBe(RIDDLES.length);
    expect(RIDDLE_BY_ID.get("riddle.baskets")!.answer).toBe(3 * 7 - 5);
    for (const r of RIDDLES) expect(Number.isInteger(r.answer) && r.answer > 0).toBe(true);
  });

  it("odbiór depozytu przy pełnym ekwipunku: reszta zostaje u trolla i nic nie ginie", () => {
    const g = confiscated();
    g.advanceTo(g.state.troll.lockUntil);
    for (let i = 0; i < 7; i++) g.do({ type: "buy", item: "item.water" });
    g.do({ type: "troll.talk", at: near(g.a.troll) });
    const ev = g.do({ type: "riddle.answer", value: RIDDLE_BY_ID.get(g.state.dialog!.riddle!)!.answer });
    expect(eventTypes(ev)).toEqual(["troll.riddle_answered"]);
    expect(g.state.troll.phase).toBe("solved");
    expect(g.state.troll.deposit.length).toBe(3);
    expect(eventTypes(g.do({ type: "troll.claim", at: near(g.a.troll) }))).toEqual(["troll.claim_failed"]);
    for (let slot = 1; slot <= 7; slot++) g.do({ type: "discard", slot });
    g.do({ type: "troll.claim", at: near(g.a.troll) });
    expect(g.state.troll.deposit).toEqual([]);
    expect(g.has("item.pickaxe") + g.has("item.saw")).toBe(2);
    g.reload();
  });

  it("odzyskiwanie ustawia narzędzia przed jedzeniem, więc jedzenie nie wypiera przedmiotów questowych", () => {
    const g = new Game();
    for (let i = 0; i < 5; i++) g.do({ type: "buy", item: "item.water" });
    g.openAndTake("chest.bridge.pickaxe");
    g.openAndTake("chest.bridge.saw");
    g.do({ type: "troll.talk", at: near(g.a.troll) });
    g.do({ type: "troll.choose", choice: "fight" });
    g.advanceTo(g.state.troll.lockUntil);
    for (let i = 0; i < 6; i++) g.do({ type: "buy", item: "item.coffee" });
    g.do({ type: "troll.talk", at: near(g.a.troll) });
    g.do({ type: "riddle.answer", value: RIDDLE_BY_ID.get(g.state.dialog!.riddle!)!.answer });
    for (let guard = 0; guard < 12 && g.state.troll.deposit.length > 0; guard++) {
      g.state.slots.forEach((s, i) => s && ITEMS[s.id].discardable && g.do({ type: "discard", slot: i }));
      g.do({ type: "troll.claim", at: near(g.a.troll) });
    }
    expect(g.state.troll.deposit.filter((s) => !ITEMS[s.id].discardable)).toEqual([]);
    expect(g.has("item.pickaxe")).toBe(1);
    expect(g.has("item.saw")).toBe(1);
  });
});

describe("Q1: pozyskiwanie surowców", () => {
  it("wymaga narzędzia, daje 1/2/5, jest skończone i ma limit jednego stosu", () => {
    const g = new Game();
    const tree = harvestTarget(g.seed, "tree", "l", 0);
    const rock = harvestTarget(g.seed, "rock", "m", 0);
    expect(eventTypes(g.do({ type: "harvest", objectId: tree.id, at: tree.at }))).toEqual(["harvest.failed"]);
    expect(g.state.toast?.text).toBe("Potrzebujesz piły, aby pozyskać drewno.");
    expect(eventTypes(g.do({ type: "harvest", objectId: rock.id, at: rock.at }))).toEqual(["harvest.failed"]);
    expect(g.state.toast?.text).toBe("Potrzebujesz kilofa, aby pozyskać kamień.");
    g.openAndTake("chest.bridge.pickaxe");
    g.openAndTake("chest.bridge.saw");
    g.harvest("tree", "s", 1);
    g.harvest("tree", "m", 2);
    g.harvest("tree", "l", 3);
    expect(g.has("resource.wood")).toBe(8);
    g.harvest("tree", "l", 3);
    expect(g.has("resource.wood")).toBe(8);
    for (let n = 4; n < 10; n++) g.harvest("rock", "m", n);
    g.harvest("rock", "s", 7);
    expect(g.has("resource.stone")).toBe(13);
    for (let n = 10; n < 20; n++) g.harvest("tree", "l", n);
    expect(g.has("resource.wood")).toBe(18);
    expect(g.state.harvested).toHaveLength(3 + 7 + 2);
    g.reload();
    expect(g.state.harvested).toHaveLength(12);
    g.harvest("tree", "s", 1);
    expect(g.state.harvested).toHaveLength(12);
  });

  it("silnik nie ufa klientowi: nieistniejący, obcy lub niepozyskiwalny obiekt, zły dystans i widok są odrzucane", () => {
    const g = new Game();
    g.openAndTake("chest.bridge.saw");
    g.openAndTake("chest.bridge.pickaxe");
    const tree = harvestTarget(g.seed, "tree", "m", 0);
    const rock = harvestTarget(g.seed, "rock", "s", 0);
    const bush = forestOf(g.seed)
      .allSectors()
      .flatMap((sec) => sec.objects)
      .find((o) => o.kind === "bush")!;
    const unchanged = (command: Command, state = g.state) => expect(applyCommand(state, command).state).toBe(state);
    unchanged({ type: "harvest", objectId: "tree.forest_start.0_0.99999", at: tree.at });
    unchanged({ type: "harvest", objectId: "tree.forest_start.99_99.1", at: tree.at });
    unchanged({ type: "harvest", objectId: "tree.inna_kraina.1_1.1", at: tree.at });
    unchanged({ type: "harvest", objectId: "to nie jest id", at: tree.at });
    unchanged({ type: "harvest", objectId: bush.id, at: { x: bush.x + 1, z: bush.z } });
    unchanged({ type: "harvest", objectId: tree.id, at: { x: tree.at.x + 30, z: tree.at.z } });
    unchanged({ type: "harvest", objectId: tree.id, at: { x: Number.NaN, z: 0 } });
    unchanged({ type: "harvest", objectId: tree.id, at: tree.at }, { ...g.state, view: "world" });
    unchanged({ type: "harvest", objectId: tree.id, at: tree.at }, { ...g.state, dead: true });
    const wood = g.has("resource.wood");
    g.do({ type: "harvest", objectId: tree.id, at: tree.at });
    expect(g.has("resource.wood")).toBe(wood + 2);
    unchanged({ type: "harvest", objectId: tree.id, at: tree.at });
    // ilość i rodzaj wynikają z obiektu, nie z komendy klienta
    g.do({ type: "harvest", objectId: rock.id, at: rock.at });
    expect(g.has("resource.stone")).toBe(1);
    expect(g.has("resource.wood")).toBe(wood + 2);
  });

  it("brak miejsca nie zużywa obiektu: surowiec nie ginie", () => {
    const g = new Game();
    g.openAndTake("chest.bridge.saw");
    for (let i = 0; i < 6; i++) g.do({ type: "buy", item: "item.water" });
    const before = g.state.harvested.length;
    const full = harvestTarget(g.seed, "tree", "l", 5);
    expect(eventTypes(g.do({ type: "harvest", objectId: full.id, at: full.at }))).toEqual(["harvest.failed"]);
    expect(g.state.harvested).toHaveLength(before);
  });
});

describe("Q1: most, nagroda i odkrycie", () => {
  function ready(): Game {
    const g = new Game();
    g.do({ type: "quest.accept", id: BRIDGE });
    g.openAndTake("chest.bridge.pickaxe");
    g.openAndTake("chest.bridge.saw");
    g.do({ type: "troll.talk", at: near(g.a.troll) });
    g.do({ type: "troll.choose", choice: "talk" });
    g.do({ type: "riddle.answer", value: RIDDLE_BY_ID.get(g.state.dialog!.riddle!)!.answer });
    g.openAndTake("chest.bridge.blueprint");
    g.harvest("tree", "l", 1);
    g.stone10();
    return g;
  }

  it("budowa jest atomowa, tylko w wyznaczonym miejscu, z kompletem materiałów i schematem", () => {
    const g = ready();
    const west = g.a.bridge.west;
    expect(eventTypes(g.do({ type: "bridge.build", at: { x: west.x - 40, z: west.z } }))).toEqual(["bridge.build_failed"]);
    expect(g.state.bridge.built).toBe(false);
    expect(g.has("resource.wood")).toBe(5);
    g.do({ type: "discard", slot: 0 });
    // brakujący materiał
    const lacking = { ...g.state, slots: g.state.slots.map((s) => (s?.id === "resource.stone" ? { ...s, count: 9 } : s)) };
    expect(applyCommand({ ...lacking, ledger: { ...lacking.ledger, spent: { ...lacking.ledger.spent, "resource.stone": 1 } } }, { type: "bridge.build", at: near(west) }).events.map((e) => e.type)).toEqual(["bridge.build_failed"]);
    g.reload();
    const wallet = g.state.wallet;
    const ev = g.do({ type: "bridge.build", at: near(west) });
    expect(eventTypes(ev)).toEqual(["bridge.built"]);
    expect(g.state.toast?.text).toMatch(/Most odbudowany/);
    expect(g.has("resource.wood")).toBe(0);
    expect(g.has("resource.stone")).toBe(0);
    expect(g.has("item.bridge_blueprint")).toBe(1);
    expect(g.state.wallet).toBe(wallet);
    expect(g.state.quests.completed[BRIDGE]).toBeUndefined();
    const crossing = g.do({ type: "region.discover", id: g.a.beyond.region, at: near(g.a.beyond) });
    expect(eventTypes(crossing)).toEqual(["region.discovered", "quest.completed"]);
    expect(g.state.toast?.text).toMatch(/Zadanie ukończone/);
    expect(g.state.wallet).toBe(wallet + 5000);
    expect(g.state.badges).toEqual(["badge.explorer"]);
    expect(g.state.quests.completed[BRIDGE]).toBeDefined();
    expect(g.do({ type: "bridge.build", at: near(west) })).toEqual([]);
    g.reload();
    expect(g.state.bridge.built).toBe(true);
    expect(g.state.wallet).toBe(wallet + 5000);
    expect(g.do({ type: "bridge.build", at: near(west) })).toEqual([]);
  });

  it("brak schematu blokuje budowę z odpowiednim powodem", () => {
    const g = new Game();
    g.openAndTake("chest.bridge.saw");
    g.openAndTake("chest.bridge.pickaxe");
    g.harvest("tree", "l", 1);
    g.stone10();
    const ev = g.do({ type: "bridge.build", at: near(g.a.bridge.west) });
    expect(ev).toEqual([{ type: "bridge.build_failed", reason: "no_blueprint" }]);
  });

  it("most zbudowany przed przyjęciem zadania nie blokuje go: przejście na drugi brzeg po przyjęciu kończy zadanie", () => {
    const g = ready();
    const fresh = { ...g.state, quests: { accepted: {}, completed: {}, read: [] } };
    g.state = fresh;
    g.do({ type: "bridge.build", at: near(g.a.bridge.west) });
    expect(g.state.quests.completed[BRIDGE]).toBeUndefined();
    const ev = g.do({ type: "quest.accept", id: BRIDGE });
    expect(eventTypes(ev)).toEqual(["quest.accepted"]);
    expect(questProgress(g.state, BRIDGE)!.stages.at(-1)!.done).toBe(false);
    expect(eventTypes(g.do({ type: "region.discover", id: g.a.beyond.region, at: near(g.a.beyond) }))).toEqual(["region.discovered", "quest.completed"]);
    expect(g.state.badges).toEqual(["badge.explorer"]);
  });

  it("drugi brzeg odkryty przed przyjęciem zadania kończy je od razu po przyjęciu", () => {
    const g = ready();
    g.state = { ...g.state, quests: { accepted: {}, completed: {}, read: [] } };
    g.do({ type: "bridge.build", at: near(g.a.bridge.west) });
    g.do({ type: "region.discover", id: g.a.beyond.region, at: near(g.a.beyond) });
    expect(g.state.quests.completed[BRIDGE]).toBeUndefined();
    expect(eventTypes(g.do({ type: "quest.accept", id: BRIDGE }))).toEqual(["quest.accepted", "quest.completed"]);
  });

  it("nowy obszar odkrywa się dopiero po moście i wejściu w jego strefę, tylko raz", () => {
    const g = ready();
    const beyond = g.a.beyond;
    expect(g.do({ type: "region.discover", id: beyond.region, at: near(beyond, 0, 0) })).toEqual([]);
    g.do({ type: "bridge.build", at: near(g.a.bridge.west) });
    expect(g.do({ type: "region.discover", id: beyond.region, at: { x: beyond.x - 60, z: beyond.z } })).toEqual([]);
    expect(eventTypes(g.do({ type: "region.discover", id: beyond.region, at: near(beyond, 1, 1) }))).toEqual(["region.discovered", "quest.completed"]);
    expect(g.do({ type: "region.discover", id: beyond.region, at: near(beyond, 1, 1) })).toEqual([]);
    g.reload();
    expect(g.state.discovered).toEqual([beyond.region]);
  });
});

describe("Q1: zapis i wczytanie na każdym etapie zadania (bez duplikatów, strat i softlocków)", () => {
  it("przejście całego questa z zapisem i wczytaniem po każdym kluczowym kroku", () => {
    const g = new Game(4242);
    const checkpoint = () => g.reload();
    g.do({ type: "board.read", id: BRIDGE });
    g.do({ type: "quest.accept", id: BRIDGE });
    checkpoint(); // po przyjęciu questa
    for (const id of ["chest.bridge.pickaxe", "chest.bridge.saw"] as const) {
      g.do({ type: "chest.open", id, at: near(g.chest(id)) });
      checkpoint(); // po otwarciu każdej skrzyni
      g.do({ type: "chest.take", id, at: near(g.chest(id)) });
      checkpoint();
    }
    g.harvest("tree", "l", 1);
    g.harvest("rock", "m", 2);
    const before = { ...g.state.ledger.gained };
    g.do({ type: "enter", view: "forest" });
    g.do({ type: "troll.talk", at: near(g.a.troll) });
    g.do({ type: "troll.choose", choice: "fight" });
    checkpoint(); // po konfiskacie
    expect(g.state.slots.filter(Boolean)).toHaveLength(1);
    g.advanceTo(g.state.troll.lockUntil);
    g.do({ type: "troll.talk", at: near(g.a.troll) });
    g.do({ type: "riddle.answer", value: RIDDLE_BY_ID.get(g.state.dialog!.riddle!)!.answer });
    checkpoint(); // po odzyskaniu depozytu
    expect(g.state.ledger.gained).toEqual(before);
    expect(g.has("item.pickaxe")).toBe(1);
    expect(g.has("resource.wood")).toBe(5);
    g.openAndTake("chest.bridge.blueprint");
    checkpoint();
    g.harvest("tree", "l", 3);
    g.harvest("rock", "m", 4);
    g.harvest("rock", "m", 5);
    g.harvest("rock", "m", 6);
    checkpoint(); // po zebraniu materiałów
    expect(g.has("resource.stone")).toBe(8);
    g.harvest("rock", "m", 7);
    checkpoint();
    expect(g.has("resource.stone")).toBe(10);
    g.do({ type: "bridge.build", at: near(g.a.bridge.west) });
    checkpoint(); // po wybudowaniu mostu
    expect(g.state.quests.completed[BRIDGE]).toBeUndefined();
    g.do({ type: "region.discover", id: g.a.beyond.region, at: near(g.a.beyond) });
    expect(g.state.quests.completed[BRIDGE]).toBeDefined();
    checkpoint(); // po ukończeniu questa
    expect(g.state.badges).toEqual(["badge.explorer"]);
    expect(g.has("item.pickaxe") + g.has("item.saw") + g.has("item.bridge_blueprint")).toBe(3);
  });
});

describe("Q1: pauza zegara (wiele niezależnych powodów)", () => {
  it("dialog z trollem zatrzymuje zegar; zamknięcie jednego powodu nie wznawia, gdy inny nadal działa", () => {
    const g = new Game();
    g.do({ type: "troll.talk", at: near(g.a.troll) });
    expect(pauseReasons(g.state)).toContain("system.dialog");
    const t = g.state.elapsed;
    expect(applyCommand(g.state, { type: "tick", dt: 5 }).state.elapsed).toBe(t);
    g.do({ type: "pause.add", reason: "ui.riddle", owner: "riddle-panel" });
    g.do({ type: "pause.add", reason: "ui.journal", owner: "journal" });
    g.do({ type: "dialog.close" });
    expect(isTimePaused(g.state)).toBe(true);
    g.do({ type: "pause.remove", reason: "ui.riddle", owner: "riddle-panel" });
    expect(isTimePaused(g.state)).toBe(true);
    expect(applyCommand(g.state, { type: "tick", dt: 5 }).state.elapsed).toBe(t);
    g.do({ type: "pause.remove", reason: "ui.journal", owner: "journal" });
    expect(isTimePaused(g.state)).toBe(false);
    expect(applyCommand(g.state, { type: "tick", dt: 5 }).state.elapsed).toBe(t + 5);
  });

  it("dialog nie jest zapisywany: po wczytaniu zegar idzie, a rozmowę można zacząć od nowa", () => {
    const g = new Game();
    g.do({ type: "troll.talk", at: near(g.a.troll) });
    g.do({ type: "troll.choose", choice: "talk" });
    expect(g.state.dialog).not.toBeNull();
    g.reload();
    expect(g.state.dialog).toBeNull();
    expect(isTimePaused(g.state)).toBe(false);
    g.do({ type: "troll.talk", at: near(g.a.troll) });
    expect(g.state.dialog?.stage).toBe("intro");
  });

  it("w czasie dialogu nie mija blokada trolla ani doba", () => {
    const g = new Game();
    g.do({ type: "troll.talk", at: near(g.a.troll) });
    g.do({ type: "troll.choose", choice: "fight" });
    const lock = g.state.troll.lockUntil;
    g.do({ type: "pause.add", reason: "ui.map", owner: "map" });
    let s = g.state;
    for (let i = 0; i < 100; i++) s = run(s, { type: "tick", dt: SECONDS_PER_DAY });
    expect(s.elapsed).toBe(g.state.elapsed);
    expect(s.elapsed).toBeLessThan(lock);
  });
});

describe("Q1: odrodzenie i dyskretne scenariusze bez softlocka", () => {
  it("po śmierci przepada jedzenie, narzędzia i surowce zostają, księga się zgadza", () => {
    const g = new Game();
    g.openAndTake("chest.bridge.saw");
    g.harvest("tree", "l", 1);
    g.do({ type: "buy", item: "item.hotdog" });
    g.state = { ...g.state, health: 0, dead: true };
    g.do({ type: "respawn" });
    expect(g.has("item.saw")).toBe(1);
    expect(g.has("resource.wood")).toBe(5);
    expect(g.has("item.hotdog")).toBe(0);
    expect(g.state.ledger.spent["item.hotdog"]).toBe(1);
  });

  it("śmierć w trakcie rozmowy zamyka dialog; wszystko wraca do normy po odrodzeniu", () => {
    const g = new Game();
    g.do({ type: "troll.talk", at: near(g.a.troll) });
    g.state = { ...g.state, health: 0, dead: true };
    g.do({ type: "respawn" });
    expect(g.state.dialog).toBeNull();
    expect(isTimePaused(g.state)).toBe(false);
  });

  it("solver kończy quest z każdego z wielu scenariuszy w różnej kolejności zdarzeń", () => {
    const orders: ((g: Game) => void)[] = [
      () => undefined,
      (g) => {
        g.openAndTake("chest.bridge.pickaxe");
        g.do({ type: "troll.talk", at: near(g.a.troll) });
        g.do({ type: "troll.choose", choice: "fight" });
      },
      (g) => {
        g.openAndTake("chest.bridge.saw");
        g.harvest("tree", "l", 1);
        g.do({ type: "troll.talk", at: near(g.a.troll) });
        g.do({ type: "troll.choose", choice: "fight" });
        g.forest();
        g.openAndTake("chest.bridge.pickaxe");
        g.harvest("rock", "m", 2);
        g.harvest("tree", "l", 3);
      },
      (g) => {
        for (let i = 0; i < 7; i++) g.do({ type: "buy", item: "item.water" });
        g.do({ type: "troll.talk", at: near(g.a.troll) });
        g.do({ type: "troll.choose", choice: "fight" });
        g.forest();
        for (let i = 0; i < 7; i++) g.do({ type: "buy", item: "item.coffee" });
      },
      (g) => {
        g.do({ type: "troll.talk", at: near(g.a.troll) });
        g.do({ type: "troll.choose", choice: "talk" });
        g.do({ type: "riddle.answer", value: -1 });
      },
    ];
    orders.forEach((setup, i) => {
      const g = new Game(1000 + i);
      setup(g);
      g.reload();
      const done = autoComplete(g.state);
      expect(done.quests.completed[BRIDGE], `scenariusz ${i}`).toBeDefined();
      expect(inventoryProblems(done.slots, done.troll.deposit, done.ledger)).toEqual([]);
    });
  });

  it("fuzz: losowe komendy zachowują niezmienniki i zapisywalność, a quest zawsze da się ukończyć", () => {
    const seeds = 60;
    const coverage = { confronted: 0, solved: 0, chestTaken: 0, harvested: 0 };
    for (let n = 0; n < seeds; n++) {
      const g = new Game(5000 + n);
      let x = (n + 1) * 2654435761;
      const rnd = () => {
        x = (Math.imul(x ^ (x >>> 15), 2246822507) + 0x9e3779b9) | 0;
        return ((x >>> 0) % 100000) / 100000;
      };
      const pick = <T,>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)];
      const chests = ["chest.bridge.pickaxe", "chest.bridge.saw", "chest.bridge.blueprint"] as const;
      const targets = harvestTargets(5000 + n);
      const harvestPoint = () => {
        const t = pick(targets);
        return { x: t.at.x, z: t.at.z };
      };
      for (let step = 0; step < 90; step++) {
        const a = g.a;
        const cid = pick(chests);
        const ht = pick(targets);
        const commands: Command[] = [
          { type: "buy", item: pick(["item.hotdog", "item.water", "item.coffee"] as const) },
          { type: "eat" },
          { type: "select", slot: Math.floor(rnd() * 8) },
          { type: "discard", slot: Math.floor(rnd() * 8) },
          { type: "chest.open", id: cid, at: near(g.chest(cid), rnd() * 3 - 1.5, 0) },
          { type: "chest.open", id: cid, at: near(g.chest(cid), 0.3, 0) },
          { type: "chest.take", id: cid, at: near(g.chest(cid), 0.2, 0.2) },
          { type: "chest.take", id: cid, at: near(g.chest(cid), 0.2, 0.2) },
          { type: "harvest", objectId: ht.id, at: ht.at },
          { type: "harvest", objectId: ht.id, at: harvestPoint() },
          { type: "enter", view: "forest" },
          { type: "region.discover", id: a.beyond.region, at: near(a.beyond) },
          { type: "troll.talk", at: near(a.troll) },
          { type: "troll.talk", at: near(a.troll, rnd() * 8 - 4, 0) },
          { type: "troll.choose", choice: pick(["fight", "talk"] as const) },
          { type: "riddle.answer", value: rnd() < 0.5 ? Math.floor(rnd() * 70) : (RIDDLE_BY_ID.get(g.state.dialog?.riddle ?? "")?.answer ?? 1) },
          { type: "troll.claim", at: near(a.troll) },
          { type: "dialog.close" },
          { type: "bridge.build", at: near(a.bridge.west, rnd() * 20 - 10, 0) },
          { type: "quest.accept", id: BRIDGE },
          { type: "tick", dt: rnd() * 200 },
          { type: "leave" },
          { type: "leave" },
        ];
        g.do(pick(commands));
        if (g.state.dead) g.do({ type: "respawn" });
        if (rnd() < 0.1) g.reload();
        if (rnd() < 0.08) g.advanceTo(g.state.troll.lockUntil);
      }
      coverage.confronted += g.state.troll.phase !== "unmet" ? 1 : 0;
      coverage.solved += g.state.troll.phase === "solved" ? 1 : 0;
      coverage.chestTaken += Object.values(g.state.chests).some((c) => c.taken) ? 1 : 0;
      coverage.harvested += g.state.harvested.length > 0 ? 1 : 0;
      const done = autoComplete(g.state);
      expect(done.bridge.built, `seed ${5000 + n}`).toBe(true);
      expect(done.quests.completed[BRIDGE]).toBeDefined();
    }
    expect(coverage.confronted).toBeGreaterThan(10);
    expect(coverage.solved).toBeGreaterThan(3);
    expect(coverage.chestTaken).toBeGreaterThan(30);
    expect(coverage.harvested).toBeGreaterThan(20);
  }, 120_000);
});
