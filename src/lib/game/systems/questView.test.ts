import { describe, expect, it } from "vitest";
import { reducer } from "../core/apply";
import { isTimePaused } from "../core/pause";
import { QUEST_BRIDGE_01 } from "../content/quests";
import { Autosaver } from "../save/autosave";
import { hydrateState } from "../save/hydrate";
import { loadGame } from "../save/loader";
import { MemoryStorage } from "../save/memoryStorage";
import { serializeState } from "../save/serialize";
import { LocalStorageSaveStore } from "../save/store";
import { newPlaying, run, slotsFrom } from "../testkit";
import { boardHasUnread } from "./quests";
import { boardEntries, journalEntries, questViews, trackedQuest } from "./questView";

describe("UI1: tablica ogłoszeń i dziennik (widoki z silnika)", () => {
  it("nowa gra po tutorialu: tablica ma wykrzyknik, zadanie jest dostępne, zapowiedzi są niedostępne", () => {
    const s = newPlaying();
    expect(boardHasUnread(s)).toBe(true);
    const entries = boardEntries(s);
    const bridge = entries.find((e) => e.def.id === QUEST_BRIDGE_01);
    expect(bridge?.status).toBe("available");
    expect(entries.filter((e) => e.def.preview).every((e) => e.status === "unavailable")).toBe(true);
    expect(trackedQuest(s)).toBeNull();
    expect(journalEntries(s)).toEqual({ active: [], completed: [] });
  });

  it("przeczytanie ogłoszenia gasi wykrzyknik, ale zadanie nadal można przyjąć", () => {
    let s = run(newPlaying(), { type: "board.read", id: QUEST_BRIDGE_01 });
    expect(boardHasUnread(s)).toBe(false);
    expect(boardEntries(s).find((e) => e.def.id === QUEST_BRIDGE_01)?.status).toBe("available");
    s = run(s, { type: "quest.accept", id: QUEST_BRIDGE_01 });
    expect(boardEntries(s).find((e) => e.def.id === QUEST_BRIDGE_01)?.status).toBe("active");
  });

  it("przyjęcie zadania daje tracker z pierwszym etapem, celami i podpowiedzią oraz wpis w dzienniku", () => {
    const s = run(newPlaying(), { type: "quest.accept", id: QUEST_BRIDGE_01 });
    const tracked = trackedQuest(s);
    expect(tracked?.def.id).toBe(QUEST_BRIDGE_01);
    expect(tracked?.stage?.id).toBe("tools");
    expect(tracked?.objectives.map((o) => o.id)).toEqual(["pickaxe", "saw"]);
    expect(tracked?.objectives.every((o) => !o.done)).toBe(true);
    expect(tracked?.hint).toMatch(/las/i);
    expect(journalEntries(s).active.map((v) => v.def.id)).toEqual([QUEST_BRIDGE_01]);
    expect(boardHasUnread(s)).toBe(false);
  });

  it("postęp surowców jest widoczny jako cele równoległe, także gdy bieżący etap dotyczy czegoś innego", () => {
    let s = run(newPlaying(), { type: "quest.accept", id: QUEST_BRIDGE_01 });
    expect(trackedQuest(s)?.parallel.map((o) => [o.id, o.current, o.target])).toEqual([
      ["wood", 0, 5],
      ["stone", 0, 10],
    ]);
    s = {
      ...s,
      slots: slotsFrom(["item.phone", "item.saw", { id: "resource.wood", count: 3 }]),
      ledger: { gained: { "item.phone": 1, "item.saw": 1, "item.pickaxe": 1, "resource.wood": 3 }, spent: {} },
    };
    const tracked = trackedQuest(s)!;
    expect(tracked.stage?.id).toBe("blueprint");
    expect(tracked.parallel.find((o) => o.id === "wood")).toMatchObject({ current: 3, target: 5, done: false });
    // Gdy bieżący etap to sam etap materiałów, cele są w głównej liście i nie powtarzają się w równoległych.
    const mats = { ...s, ledger: { gained: { ...s.ledger.gained, "item.bridge_blueprint": 1 }, spent: {} } };
    const t2 = trackedQuest(mats)!;
    expect(t2.stage?.id).toBe("materials");
    expect(t2.objectives.map((o) => o.id)).toEqual(["wood", "stone"]);
    expect(t2.parallel).toEqual([]);
  });

  it("ponowne przyjęcie tego samego zadania nic nie zmienia", () => {
    const once = run(newPlaying(), { type: "quest.accept", id: QUEST_BRIDGE_01 });
    expect(run(once, { type: "quest.accept", id: QUEST_BRIDGE_01 })).toBe(once);
  });

  it("silnik pozwala przyjąć zadanie w tutorialu (blokadę tablicy daje interfejs), ale nie po śmierci gracza", () => {
    const tutorial = { ...newPlaying(), tutorialDone: false };
    expect(trackedQuest(run(tutorial, { type: "quest.accept", id: QUEST_BRIDGE_01 }))).not.toBeNull();
    const dead = { ...newPlaying(), dead: true };
    expect(run(dead, { type: "quest.accept", id: QUEST_BRIDGE_01 })).toBe(dead);
  });

  it("zapowiedzi nie da się przyjąć", () => {
    const s = newPlaying();
    const preview = questViews(s).find((v) => v.def.preview);
    expect(preview).toBeDefined();
    if (!preview) return;
    expect(run(s, { type: "quest.accept", id: preview.def.id })).toBe(s);
  });

  it("panel tablicy lub dziennika wstrzymuje zegar i go wznawia", () => {
    let s = newPlaying();
    const t0 = s.elapsed;
    s = run(s, { type: "pause.add", owner: "ui.panel", reason: "ui.journal" }, { type: "tick", dt: 5 });
    expect(isTimePaused(s)).toBe(true);
    expect(s.elapsed).toBe(t0);
    s = run(s, { type: "pause.remove", owner: "ui.panel", reason: "ui.journal" }, { type: "tick", dt: 5 });
    expect(isTimePaused(s)).toBe(false);
    expect(s.elapsed).toBeGreaterThan(t0);
  });

  it("zapis i odczyt zachowują przyjęte zadanie, przeczytanie ogłoszenia i bieżący etap", () => {
    const s = run(newPlaying(), { type: "quest.accept", id: QUEST_BRIDGE_01 }, { type: "pause.add", owner: "ui.panel", reason: "ui.journal" });
    const save = serializeState(s, 1);
    expect(save).not.toBeNull();
    if (!save) return;
    const back = hydrateState(save);
    expect(back.quests).toEqual(s.quests);
    expect(back.pauses).toEqual([]);
    expect(trackedQuest(back)?.stage?.id).toBe("tools");
    expect(boardHasUnread(back)).toBe(false);
  });

  it("odświeżenie strony: autosave po przyjęciu zadania, loadGame i game.load odtwarzają śledzone zadanie", async () => {
    const storage = new MemoryStorage();
    const store = new LocalStorageSaveStore({ storage });
    const saver = new Autosaver({ store, now: () => 1 });
    let s = newPlaying();
    saver.update(s);
    s = reducer(s, { type: "quest.accept", id: QUEST_BRIDGE_01 });
    saver.update(s);
    const outcome = await saver.saveNow();
    expect(outcome).toEqual({ ok: true });
    saver.dispose();

    const booted = await loadGame(new LocalStorageSaveStore({ storage }));
    if (booted.kind !== "ok") throw new Error(`oczekiwano ok, jest ${booted.kind}`);
    const loaded = run(
      { ...newPlaying(), phase: "name" },
      { type: "game.load", save: booted.save },
    );
    expect(loaded.phase).toBe("playing");
    expect(trackedQuest(loaded)?.def.id).toBe(QUEST_BRIDGE_01);
    expect(loaded.quests.accepted[QUEST_BRIDGE_01]).toBeDefined();
  });

  it("saveNow: pomija zapis bez zmian i zgłasza błąd, gdy gra nie jest aktywna", async () => {
    const storage = new MemoryStorage();
    const saver = new Autosaver({ store: new LocalStorageSaveStore({ storage }), now: () => 1 });
    expect((await saver.saveNow()).ok).toBe(false);
    saver.update(newPlaying());
    expect(await saver.saveNow()).toEqual({ ok: true });
    expect(await saver.saveNow()).toEqual({ ok: true });
    saver.dispose();
  });
});
