import { beforeEach, describe, expect, it } from "vitest";
import type { TrollAsset } from "@/lib/assets/characters";
import { NpcLayer, trollPlacement } from "@/lib/forest-view/npc";
import { forestOf, forestWalkOf } from "@/lib/game/world/lookup";
import { ENCOUNTER } from "./encounter";
import { loadTestTroll } from "./testkit";
import { TROLL_PATROL_RADIUS, TrollNpc } from "./troll";

const SEED = 2030;
const DT = 1 / 60;
let asset: TrollAsset;

beforeEach(async () => {
  asset = await loadTestTroll();
});

const make = () => {
  const forest = forestOf(SEED);
  const place = trollPlacement(forest);
  const npc = new TrollNpc({ asset, walk: forestWalkOf(SEED), terrain: forest.terrain, home: place.home, faceTo: place.faceTo, seed: SEED, castShadow: false, receiveShadow: false });
  return { npc, place };
};

type Frame = { t: number; d: number; behavior: string; anim: string; yawError: number; yawRate: number; weightSum: number; x: number; z: number };

/** Symulacja klatka po klatce; gracz idzie po prostej do trolla albo stoi. Zwraca nagranie wszystkich klatek. */
class Session {
  readonly frames: Frame[] = [];
  readonly dialogAt: number[] = [];
  player = { x: 0, z: 0 };
  clock = 0;
  private prevYaw: number;

  constructor(readonly npc: TrollNpc) {
    this.prevYaw = npc.patrol.yaw;
    npc.setDialogListener(() => this.dialogAt.push(this.clock));
  }

  tick(): Frame {
    this.npc.update(DT, this.player);
    this.clock += DT;
    const n = this.npc;
    const bearing = Math.atan2(this.player.x - n.x, this.player.z - n.z);
    const err = Math.atan2(Math.sin(bearing - n.patrol.yaw), Math.cos(bearing - n.patrol.yaw));
    const yawStep = Math.atan2(Math.sin(n.patrol.yaw - this.prevYaw), Math.cos(n.patrol.yaw - this.prevYaw));
    this.prevYaw = n.patrol.yaw;
    const weights = Object.values(n.animator.weights());
    const frame = {
      t: this.clock,
      d: n.distance,
      behavior: n.encounterState,
      anim: n.animator.state,
      yawError: Math.abs(err),
      yawRate: Math.abs(yawStep) / DT,
      weightSum: weights.reduce((a, b) => a + b, 0),
      x: n.x,
      z: n.z,
    };
    this.frames.push(frame);
    return frame;
  }

  run(seconds: number, until?: (f: Frame) => boolean): void {
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      const frame = this.tick();
      if (until?.(frame)) return;
    }
  }

  /** Gracz podchodzi do trolla po linii od strony +x z prędkością `speed` aż do odległości `to`. */
  approach(from: number, to: number, speed = 3, until?: (f: Frame) => boolean): void {
    const n = this.npc;
    let d = from;
    this.player = { x: n.x + d, z: n.z };
    while (d > to) {
      d = Math.max(to, d - speed * DT);
      this.player = { x: n.x + d, z: n.z };
      const frame = this.tick();
      if (until?.(frame)) return;
      if (this.clock > 600) throw new Error("approach: za długo");
    }
    if (until) this.run(30, until);
  }

  stand(distance: number): void {
    this.player = { x: this.npc.x + distance, z: this.npc.z };
  }
}

const first = (frames: Frame[], pred: (f: Frame) => boolean) => frames.findIndex(pred);

describe("troll: spotkanie z graczem od 40 m do dialogu (prawdziwy model i animacje)", () => {
  it("pełny przebieg: patrol, alert na 20 m, zauważenie na 5 m, obrót, Surprised raz, dialog po zdarzeniu końca klipu", () => {
    const { npc } = make();
    const s = new Session(npc);
    s.stand(40);
    s.run(20);
    expect(s.frames.every((f) => f.behavior === "patrol")).toBe(true);
    expect(s.frames.some((f) => f.anim === "walk")).toBe(true);

    s.frames.length = 0;
    s.approach(40, 3, 3, (f) => f.behavior === "dialog");
    s.run(0.1);
    const f = s.frames;
    const alertAt = first(f, (x) => x.behavior === "alert");
    expect(alertAt).toBeGreaterThan(0);
    expect(f[alertAt].d).toBeLessThan(20);
    expect(f[alertAt].d).toBeGreaterThan(18);

    const noticeAt = first(f, (x) => x.behavior === "notice");
    expect(noticeAt).toBeGreaterThan(alertAt);
    expect(f[noticeAt].d).toBeLessThan(5.01);
    expect(f[noticeAt].d).toBeGreaterThan(4.5);
    const surprisedAt = first(f, (x) => x.behavior === "surprised");
    expect(surprisedAt).toBeGreaterThan(noticeAt);
    expect(f[surprisedAt].yawError).toBeLessThan(ENCOUNTER.facingTolerance + 1e-6);
    expect(f[noticeAt].yawError).toBeGreaterThan(0);
    expect(s.dialogAt).toHaveLength(1);

    expect(f.some((x) => x.behavior === "surprised" && x.anim !== "surprised")).toBe(false);
    const surprisedFrames = f.filter((x) => x.anim === "surprised");
    expect(surprisedFrames.length * DT).toBeGreaterThan(3.8);
    expect(surprisedFrames.length * DT).toBeLessThan(4.3);
    const dialogFrame = f.findIndex((x) => x.behavior === "dialog");
    expect(dialogFrame).toBeGreaterThan(surprisedAt + 200);
    expect(npc.encounter.dialogActive).toBe(true);
    s.run(2);
    expect(s.dialogAt).toHaveLength(1);
    expect(npc.animator.state).toBe("idle");
    expect(npc.animator.isReacting).toBe(false);
    expect(s.frames[s.frames.length - 1].yawError).toBeLessThan(ENCOUNTER.facingTolerance);
  });

  it("Walk -> Idle jest płynnym przejściem (suma wag = 1, bez skoku), a Nervous gra po chwili i wraca do Idle", () => {
    const { npc } = make();
    const s = new Session(npc);
    s.stand(60);
    s.run(40, () => npc.patrol.mode === "walk" && npc.patrol.speed > 1);
    expect(npc.animator.state).toBe("walk");
    s.frames.length = 0;
    // Gracz pojawia się na 19 m w chwili, gdy troll idzie: alert przerywa patrol, troll hamuje i przechodzi z Walk w Idle.
    s.stand(19);
    s.run(40);
    const f = s.frames;
    for (const x of f) expect(Math.abs(x.weightSum - 1)).toBeLessThan(1e-6);
    const alertAt = first(f, (x) => x.behavior === "alert");
    expect(f[alertAt].anim).toBe("walk");
    const idleAt = first(f, (x) => x.anim === "idle");
    expect(idleAt).toBeGreaterThan(alertAt);
    const braking = f.slice(alertAt, idleAt);
    expect(braking.length * DT).toBeLessThan(1.2);
    const nervousAt = first(f, (x) => x.anim === "nervous");
    expect(nervousAt).toBeGreaterThan(idleAt);
    expect(f.slice(nervousAt).every((x) => x.anim !== "walk")).toBe(true);
    const nervous = f.filter((x) => x.anim === "nervous").length * DT;
    expect(nervous).toBeGreaterThan(6);
    const order = f.map((x) => x.anim).filter((a, i, arr) => a !== arr[i - 1]);
    expect(order.slice(0, 4)).toEqual(["walk", "idle", "nervous", "idle"]);
    expect(f.some((x) => x.behavior === "surprised" || x.anim === "surprised")).toBe(false);
    expect(s.dialogAt).toEqual([]);
  });

  it("obrót ku graczowi jest płynny (bez teleportu i gwałtownego zwrotu), a pozycja trolla nie ucieka z miejsca spotkania", () => {
    const { npc, place } = make();
    const s = new Session(npc);
    s.stand(40);
    s.run(10);
    s.frames.length = 0;
    s.approach(40, 3, 3, (f) => f.behavior === "surprised");
    const f = s.frames;
    expect(f.length).toBeGreaterThan(60);
    const noticeAt = first(f, (x) => x.behavior === "notice");
    const turn = f.slice(noticeAt);
    expect(Math.max(...turn.map((x) => x.yawRate))).toBeLessThanOrEqual(1.6 + 1e-6);
    expect(turn.length * DT).toBeGreaterThan(0.2);
    let maxStep = 0;
    for (let i = 1; i < f.length; i++) maxStep = Math.max(maxStep, Math.hypot(f[i].x - f[i - 1].x, f[i].z - f[i - 1].z));
    expect(maxStep).toBeLessThan(0.03);
    for (const x of f) expect(Math.hypot(x.x - place.home.x, x.z - place.home.z)).toBeLessThanOrEqual(TROLL_PATROL_RADIUS + 1e-6);
  });

  it("w czasie Surprised troll stoi w miejscu i nie przerywa klipu, gdy gracz biega w tę i z powrotem", () => {
    const { npc } = make();
    const s = new Session(npc);
    s.stand(40);
    s.run(10);
    s.approach(40, 3, 3, (f) => f.behavior === "surprised");
    const at = { x: npc.x, z: npc.z };
    s.frames.length = 0;
    for (let i = 0; i < 60 * 3; i++) {
      s.player = { x: npc.x + (i % 120 < 60 ? 2 : 30), z: npc.z };
      s.tick();
    }
    expect(s.frames.every((x) => x.anim === "surprised")).toBe(true);
    expect(Math.hypot(npc.x - at.x, npc.z - at.z)).toBeLessThan(1e-9);
  });
});

const toDialog = () => {
  const made = make();
  const s = new Session(made.npc);
  s.stand(40);
  s.run(10);
  s.approach(40, 3, 3, (f) => f.behavior === "dialog");
  s.run(0.5);
  expect(made.npc.encounter.dialogActive).toBe(true);
  return { ...made, s };
};

describe("troll: reakcje po dialogu", () => {
  it("PRAWIDŁOWY: Happy raz, płynnie Dance raz od początku do końca, potem Idle; bez ruchu i bez ponownego dialogu", () => {
    const { npc, s } = toDialog();
    const at = { x: npc.x, z: npc.z };
    expect(npc.resolveDialog("correct")).toBe(true);
    s.frames.length = 0;
    // Gracz biega w trakcie sekwencji: zwykłe zmiany odległości jej nie przerywają.
    for (let i = 0; i < 60 * 25 && npc.encounterState === "celebrate"; i++) {
      s.player = { x: npc.x + [2, 40, 8, 25][Math.floor(i / 90) % 4], z: npc.z };
      s.tick();
    }
    s.stand(30);
    s.run(3);
    const f = s.frames;
    const happy = f.filter((x) => x.anim === "happy").length * DT;
    const dance = f.filter((x) => x.anim === "dance").length * DT;
    expect(happy).toBeGreaterThan(3.3);
    expect(happy).toBeLessThan(3.9);
    expect(dance).toBeGreaterThan(14.4);
    expect(dance).toBeLessThan(15.1);
    expect(f.findIndex((x) => x.anim === "dance")).toBeGreaterThan(f.findIndex((x) => x.anim === "happy"));
    const order = f.map((x) => x.anim).filter((a, i, arr) => a !== arr[i - 1]);
    expect(order.slice(0, 3)).toEqual(["happy", "dance", order[2]]);
    expect(["idle", "walk"]).toContain(order[2]);
    for (const x of f) expect(Math.abs(x.weightSum - 1)).toBeLessThan(1e-6);
    expect(Math.hypot(f[f.length - 1].x - at.x, f[f.length - 1].z - at.z)).toBeLessThanOrEqual(TROLL_PATROL_RADIUS + 1e-6);
    const during = f.filter((x) => x.behavior === "celebrate");
    for (const x of during) expect(Math.hypot(x.x - at.x, x.z - at.z)).toBeLessThan(1e-6);
    expect(f.some((x) => x.anim === "surprised")).toBe(false);
  });

  it("po Dance gracz daleko: patrol, gracz blisko: alert; dialog nie otwiera się sam", () => {
    for (const distance of [30, 2]) {
      const { npc, s } = toDialog();
      npc.resolveDialog("correct");
      s.stand(distance);
      s.run(30);
      expect(["patrol", "alert"]).toContain(npc.encounterState);
      expect(npc.encounterState).toBe(distance > 22 ? "patrol" : "alert");
      s.run(120);
      expect(s.dialogAt, `d=${distance}`).toHaveLength(1);
    }
  });

  it("ZŁY: Angry raz bez przerwania (ok. 3,3 s), potem Idle; bez teleportu, bez pętli dialogu", () => {
    const { npc, s } = toDialog();
    const at = { x: npc.x, z: npc.z };
    expect(npc.resolveDialog("wrong")).toBe(true);
    s.frames.length = 0;
    for (let i = 0; i < 60 * 12 && npc.encounterState === "angry"; i++) {
      s.player = { x: npc.x + [2, 40, 8][Math.floor(i / 50) % 3], z: npc.z };
      s.tick();
    }
    s.stand(30);
    s.run(3);
    const f = s.frames;
    const angry = f.filter((x) => x.anim === "angry").length * DT;
    expect(angry).toBeGreaterThan(3.0);
    expect(angry).toBeLessThan(3.6);
    const start = f.findIndex((x) => x.anim === "angry");
    const end = f.length - 1 - [...f].reverse().findIndex((x) => x.anim === "angry");
    expect(f.slice(start, end + 1).every((x) => x.anim === "angry")).toBe(true);
    for (const x of f.filter((y) => y.behavior === "angry")) expect(Math.hypot(x.x - at.x, x.z - at.z)).toBeLessThan(1e-6);
    expect(["idle", "walk"]).toContain(npc.animator.state);
    expect(f.some((x) => x.anim === "surprised" || x.anim === "happy" || x.anim === "dance")).toBe(false);
  });

  it("zamknięcie dialogu bez wyboru (Esc): troll wraca do Idle/alertu bez reakcji i nie otwiera dialogu ponownie przy stojącym graczu", () => {
    const { npc, s } = toDialog();
    expect(npc.resolveDialog("dismissed")).toBe(true);
    s.frames.length = 0;
    s.run(90);
    expect(s.dialogAt).toHaveLength(1);
    expect(s.frames.some((x) => ["surprised", "happy", "dance", "angry"].includes(x.anim))).toBe(false);
    expect(npc.encounterState).toBe("alert");
    expect(npc.encounter.encounterCount).toBe(1);
  });

  it("kolejne spotkanie: po oddaleniu i ponownym zbliżeniu albo przez restart; Surprised znów raz i dialog znów raz", () => {
    const { npc, s } = toDialog();
    npc.resolveDialog("dismissed");
    s.stand(15);
    s.run(3);
    s.approach(15, 3, 3, (f) => f.behavior === "dialog");
    s.run(0.2);
    expect(s.dialogAt).toHaveLength(2);
    expect(npc.encounter.encounterCount).toBe(2);
    npc.resolveDialog("wrong");
    s.run(8);
    expect(npc.encounter.restart()).toBe(true);
    s.run(30, () => npc.encounterState === "dialog");
    expect(s.dialogAt).toHaveLength(3);
  });

  it("wyjście z lasu w trakcie animacji: dispose sprząta mikser i nasłuch, żadne zdarzenie nie przychodzi po fakcie", () => {
    const made = make();
    const s = new Session(made.npc);
    s.stand(40);
    s.run(10);
    s.approach(40, 3, 3, (f) => f.anim === "surprised");
    s.run(1);
    expect(made.npc.animator.state).toBe("surprised");
    made.npc.dispose();
    const before = s.dialogAt.length;
    expect(() => s.run(10)).not.toThrow();
    expect(s.dialogAt.length).toBe(before);
    expect(made.npc.animator.weights()).toEqual({});
    expect(() => made.npc.dispose()).not.toThrow();
    expect(made.npc.group.parent).toBeNull();
  });
});

describe("NpcLayer: dialog i spotkanie widziane z renderera", () => {
  it("udostępnia stan do panelu F3 i prosi o dialog dokładnie raz; wynik dialogu i restart działają przez warstwę", () => {
    const forest = forestOf(SEED);
    const layer = new NpcLayer(asset, { forest, walk: forestWalkOf(SEED), seed: SEED, castShadow: false, receiveShadow: false });
    let requests = 0;
    layer.onDialog(() => requests++);
    const troll = layer.troll;
    const at = (d: number) => ({ x: troll.x + d, z: troll.z });
    for (let i = 0; i < 60 * 10; i++) layer.update(DT, at(40));
    expect(layer.stats().behavior).toBe("patrol");
    let d = 40;
    for (let i = 0; i < 60 * 40 && !layer.stats().dialogActive; i++) {
      d = Math.max(3, d - 3 * DT);
      layer.update(DT, at(d));
    }
    const stats = layer.stats();
    expect(requests).toBe(1);
    expect(stats.dialogActive).toBe(true);
    expect(stats.behavior).toBe("dialog");
    expect(stats.encounters).toBe(1);
    expect(stats.armed).toBe(false);
    expect(stats.clip).toBe("Idle");
    expect(stats.clipDuration).toBeGreaterThan(3);
    expect(stats.distance).toBeCloseTo(3, 1);
    for (let i = 0; i < 60 * 3; i++) layer.update(DT, at(3));
    expect(requests).toBe(1);

    expect(layer.resolveDialog("correct")).toBe(true);
    layer.update(DT, at(3));
    expect(layer.stats().clip).toBe("Happy");
    expect(layer.stats().behavior).toBe("celebrate");
    expect(layer.restartEncounter()).toBe(false);
    for (let i = 0; i < 60 * 25; i++) layer.update(DT, at(3));
    expect(layer.stats().behavior).toBe("alert");
    expect(layer.restartEncounter()).toBe(true);
    expect(layer.stats().armed).toBe(true);
    layer.dispose();
  });
});
