import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SECONDS_PER_DAY, SECONDS_PER_GAME_HOUR } from "@/lib/game/core/constants";
import { FIRST_MIDNIGHT } from "./clock";
import { ForestAudioController, WOLVES_CONFIG } from "./controller";
import type { AudioManifest } from "./manifest";
import { FakeContext, FakeGain, FakePanner, FakeSource, FakeTarget, fakeFetch, MemoryStorage, mulberry32, TEST_MANIFEST } from "./testkit";

const H = SECONDS_PER_GAME_HOUR;
/** Czas gry (s) dla godziny zegara pierwszej doby (06:00 = 0). */
const at = (hour: number, day = 0) => ((hour - 6 + 24) % 24) * H + day * SECONDS_PER_DAY;

type Rig = {
  audio: ForestAudioController;
  ctxs: FakeContext[];
  storage: MemoryStorage;
  doc: FakeTarget;
  win: FakeTarget;
  fetched: string[];
};

function rig(options: { manifest?: AudioManifest; storage?: MemoryStorage; seed?: number; resumeAllowed?: boolean } = {}): Rig {
  const ctxs: FakeContext[] = [];
  const storage = options.storage ?? new MemoryStorage();
  const doc = new FakeTarget();
  const win = new FakeTarget();
  const fetched: string[] = [];
  const audio = new ForestAudioController({
    createContext: () => {
      const c = new FakeContext();
      if (options.resumeAllowed === false) {
        c.state = "suspended";
        c.allowResume = false;
      }
      ctxs.push(c);
      return c as unknown as AudioContext;
    },
    fetch: fakeFetch(options.manifest ?? TEST_MANIFEST, fetched),
    rng: mulberry32(options.seed ?? 42),
    now: () => Date.now(),
    storage,
    canPlayType: (type) => (type.includes("ogg") ? "probably" : ""),
    document: doc as unknown as Document,
    window: win as unknown as Window,
  });
  return { audio, ctxs, storage, doc, win, fetched };
}

const flush = async (ms = 0) => {
  await vi.advanceTimersByTimeAsync(ms);
};

/** Przesuwa czas rzeczywisty i zegar gry razem, jak GameApp (20 s = 1 godzina gry). */
async function play(r: Rig, seconds: number, startElapsed: number, opts: { pose?: boolean } = {}) {
  let elapsed = startElapsed;
  for (let t = 0; t < seconds; t += 0.1) {
    elapsed += 0.1;
    r.audio.setClock(elapsed);
    if (opts.pose) r.audio.setPose({ x: t, z: 0, yaw: 0 });
    await flush(100);
  }
  return elapsed;
}

const sources = (c: FakeContext) => c.sources;
const loops = (c: FakeContext) => sources(c).filter((s) => s.loop);
const voices = (c: FakeContext, id: string) => sources(c).filter((s) => s.buffer?.id === id);
const activeVoices = (c: FakeContext) => sources(c).filter((s) => !s.loop && s.buffer?.id !== "synth" && !s.stopped);
const wolves = (c: FakeContext) => voices(c, "event.wolves");

function layerGains(r: Rig) {
  const d = r.audio.getDiagnostics();
  return { day: d.dayGain, night: d.nightGain };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ForestAudioController: ambient", () => {
  it("w południe gra tylko dzienne tło w pętli, bez nocnego", async () => {
    const r = rig();
    r.audio.enter({ elapsed: at(12), saveId: "s" });
    await flush(1000);
    const c = r.ctxs[0];
    expect(loops(c)).toHaveLength(1);
    expect(loops(c)[0].buffer?.id).toBe("ambience.day");
    expect(loops(c)[0].started).not.toBeNull();
    expect(layerGains(r)).toEqual({ day: 1, night: 0 });
    expect(r.fetched.some((u) => u.includes("night"))).toBe(false);
    r.audio.dispose();
  });

  it("w nocy gra tylko nocne tło i nie wczytuje dziennych ptaków", async () => {
    const r = rig();
    r.audio.enter({ elapsed: at(1), saveId: "s" });
    await flush(1000);
    const c = r.ctxs[0];
    expect(loops(c).map((s) => s.buffer?.id)).toEqual(["ambience.night"]);
    expect(layerGains(r)).toEqual({ day: 0, night: 1 });
    expect(r.fetched.some((u) => u.includes("bird."))).toBe(false);
    expect(r.fetched.some((u) => u.includes("ambience.day"))).toBe(false);
    r.audio.dispose();
  });

  it("o świcie oba tła grają z crossfade o stałej mocy, a poza przejściem nigdy oba na 100%", async () => {
    const r = rig();
    r.audio.enter({ elapsed: at(6.5), saveId: "s" });
    await flush(1000);
    const g = layerGains(r);
    expect(g.day).toBeGreaterThan(0.3);
    expect(g.night).toBeGreaterThan(0.3);
    expect(g.day ** 2 + g.night ** 2).toBeCloseTo(1, 2);
    expect(loops(r.ctxs[0])).toHaveLength(2);
    r.audio.dispose();
  });

  it("zmiana godziny w czasie rzeczywistym przesuwa miks płynnie (stałe wygładzanie, bez skoków wartości)", async () => {
    const r = rig();
    let elapsed = at(4.5);
    r.audio.enter({ elapsed, saveId: "s" });
    await flush(500);
    const seen: { day: number; night: number }[] = [];
    for (let i = 0; i < 900; i++) {
      elapsed += 0.1;
      r.audio.setClock(elapsed);
      await flush(100);
      seen.push(layerGains(r));
    }
    expect(seen[0].night).toBe(1);
    expect(seen[seen.length - 1].day).toBeGreaterThan(0.9);
    for (let i = 1; i < seen.length; i++) {
      expect(Math.abs(seen[i].day - seen[i - 1].day)).toBeLessThan(0.05);
      expect(Math.abs(seen[i].night - seen[i - 1].night)).toBeLessThan(0.05);
    }
    const c = r.ctxs[0];
    const gains = c.nodes.filter((n): n is FakeGain => n instanceof FakeGain);
    expect(gains.some((n) => n.gain.tau >= 0.5)).toBe(true);
    r.audio.dispose();
  });

  it("skok godziny z panelu dev (zapowiedziany) aktualizuje miks bez wilków", async () => {
    const r = rig();
    r.audio.enter({ elapsed: at(12), saveId: "s" });
    await flush(1000);
    const target = at(12) + 13 * H;
    r.audio.jumpClock(target);
    r.audio.setClock(target);
    await flush(1000);
    expect(layerGains(r)).toEqual({ day: 0, night: 1 });
    expect(wolves(r.ctxs[0])).toHaveLength(0);
    r.audio.dispose();
  });

  it("zwalnia nieużywane tło po dłuższej ciszy i wczytuje je ponownie z wyprzedzeniem", async () => {
    const r = rig();
    r.audio.enter({ elapsed: at(12), saveId: "s" });
    await flush(1000);
    expect(r.audio.getDiagnostics().loaded).toContain("ambience.day");
    expect(r.audio.getDiagnostics().loaded).not.toContain("ambience.night");
    const jump = at(8.5) + 0;
    r.audio.jumpClock(jump);
    r.audio.setClock(jump);
    await flush(1000);
    let elapsed = jump;
    for (let i = 0; i < 20; i++) {
      elapsed += 20 * 0.4;
      r.audio.setClock(elapsed);
      await flush(5000);
    }
    expect(r.audio.getDiagnostics().loaded).not.toContain("ambience.night");
    r.audio.dispose();
  });
});

describe("ForestAudioController: ptaki", () => {
  it("w dzień losuje pojedyncze nawoływania z różnych kierunków, w odległości 15-60 m, z limitem 2 naraz", async () => {
    const r = rig({ seed: 5 });
    r.audio.enter({ elapsed: at(12), saveId: "s" });
    r.audio.setPose({ x: 100, z: -40, yaw: 1 });
    await flush(1000);
    const c = r.ctxs[0];
    let maxConcurrent = 0;
    let elapsed = at(12);
    for (let i = 0; i < 6000; i++) {
      elapsed += 0.02;
      r.audio.setClock(elapsed);
      await flush(200);
      maxConcurrent = Math.max(maxConcurrent, r.audio.getDiagnostics().activeEffects);
      activeVoices(c).forEach((s, k) => (k + i) % 2 === 0 && s.finish());
    }
    const birds = sources(c).filter((s) => s.buffer?.id.startsWith("bird."));
    expect(birds.length).toBeGreaterThan(20);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
    expect(new Set(birds.map((s) => s.buffer?.id))).toEqual(new Set(["bird.cockatoo", "bird.jungle", "bird.screech"]));
    const panners = c.nodes.filter((n): n is FakePanner => n instanceof FakePanner);
    expect(panners.length).toBe(birds.length);
    const sides = new Set<string>();
    for (const p of panners) {
      const dx = p.position.x - 100;
      const dz = p.position.z + 40;
      const d = Math.hypot(dx, dz);
      expect(d).toBeGreaterThanOrEqual(14.99);
      expect(d).toBeLessThanOrEqual(60.01);
      expect(p.panningModel).toBe("HRTF");
      expect(p.distanceModel).toBe("inverse");
      expect(p.position.y).toBeGreaterThan(1.6);
      sides.add(`${Math.sign(Math.round(dx / 10))}${Math.sign(Math.round(dz / 10))}`);
    }
    expect(sides.size).toBeGreaterThanOrEqual(6);
    const rates = new Set(birds.map((s) => Math.round(s.playbackRate.value * 100)));
    expect(rates.size).toBeGreaterThan(3);
    for (let i = 1; i < birds.length; i++) expect(birds[i].buffer?.id).not.toBe(birds[i - 1].buffer?.id);
    r.audio.dispose();
  });

  it("w nocy nie odtwarza dziennych ptaków nawet po godzinie czasu", async () => {
    const r = rig({ seed: 7 });
    r.audio.enter({ elapsed: at(23), saveId: "s" });
    await flush(1000);
    let elapsed = at(23);
    for (let i = 0; i < 600; i++) {
      elapsed += 0.03;
      r.audio.setClock(elapsed);
      await flush(200);
    }
    expect(sources(r.ctxs[0]).filter((s) => s.buffer?.id.startsWith("bird."))).toHaveLength(0);
    r.audio.dispose();
  });

  it("obrót kamery zmienia orientację słuchacza, a źródła zostają w świecie", async () => {
    const r = rig();
    r.audio.enter({ elapsed: at(12), saveId: "s" });
    await flush(100);
    const l = r.ctxs[0].listener;
    r.audio.setPose({ x: 3, z: 4, yaw: 0 });
    expect([l.forwardX.target, l.forwardZ.target]).toEqual([-0, -1]);
    expect([l.positionX.target, l.positionZ.target]).toEqual([3, 4]);
    r.audio.setPose({ x: 3, z: 4, yaw: Math.PI / 2 });
    expect(l.forwardX.target).toBeCloseTo(-1);
    expect(l.forwardZ.target).toBeCloseTo(0);
    r.audio.dispose();
  });

  it("podczas dialogu ambient jest cichszy, a ptaków jest mniej", async () => {
    const countBirds = async (dialog: boolean) => {
      const r = rig({ seed: 11 });
      r.audio.setMode({ dialog, frozen: dialog });
      r.audio.enter({ elapsed: at(12), saveId: "s" });
      await flush(1000);
      let elapsed = at(12);
      for (let i = 0; i < 3000; i++) {
        elapsed += 0.02;
        r.audio.setClock(elapsed);
        await flush(200);
        for (const s of activeVoices(r.ctxs[0])) s.finish();
      }
      const gains = r.ctxs[0].nodes.filter((n): n is FakeGain => n instanceof FakeGain).map((g) => g.gain.target);
      const birds = sources(r.ctxs[0]).filter((s) => s.buffer?.id.startsWith("bird.")).length;
      r.audio.dispose();
      return { birds, quiet: gains.includes(0.45) };
    };
    const normal = await countBirds(false);
    const dialog = await countBirds(true);
    expect(dialog.quiet).toBe(true);
    expect(normal.quiet).toBe(false);
    expect(dialog.birds).toBeLessThan(normal.birds * 0.5);
  });
});

describe("ForestAudioController: wilki o północy", () => {
  async function toMidnight(r: Rig, saveId = "s") {
    const start = FIRST_MIDNIGHT - 5;
    r.audio.enter({ elapsed: start, saveId });
    r.audio.setPose({ x: 0, z: 0, yaw: 0 });
    await flush(1000);
    return start;
  }

  it("odtwarza wilki dokładnie raz przy naturalnym przejściu 23:59 -> 00:00, daleko i bez pętli", async () => {
    const r = rig();
    const start = await toMidnight(r);
    const c = r.ctxs[0];
    expect(wolves(c)).toHaveLength(0);
    await play(r, 12, start);
    expect(wolves(c)).toHaveLength(1);
    const w = wolves(c)[0];
    expect(w.loop).toBe(false);
    const panner = c.nodes.filter((n): n is FakePanner => n instanceof FakePanner).at(-1)!;
    const d = Math.hypot(panner.position.x, panner.position.z);
    expect(d).toBeGreaterThanOrEqual(WOLVES_CONFIG.distance[0] - 0.01);
    expect(d).toBeLessThanOrEqual(WOLVES_CONFIG.distance[1] + 0.01);
    r.audio.dispose();
  });

  it("ścisza ambient na czas wilków i przywraca głośność po zakończeniu efektu", async () => {
    const r = rig();
    const start = await toMidnight(r);
    const c = r.ctxs[0];
    await play(r, 7, start);
    const gains = c.nodes.filter((n): n is FakeGain => n instanceof FakeGain);
    expect(gains.some((g) => g.gain.target === WOLVES_CONFIG.duck)).toBe(true);
    const duck = gains.find((g) => g.gain.target === WOLVES_CONFIG.duck)!;
    wolves(c)[0].finish();
    expect(duck.gain.target).toBe(1);
    expect(r.audio.getDiagnostics().activeEffects).toBe(0);
    r.audio.dispose();
  });

  it("nie powtarza wilków przez resztę minuty, pauzę (ten sam czas) ani następne godziny tej nocy", async () => {
    const r = rig();
    const start = await toMidnight(r);
    const end = await play(r, 12, start);
    for (let i = 0; i < 50; i++) {
      r.audio.setClock(end);
      await flush(100);
    }
    await play(r, 40, end);
    expect(wolves(r.ctxs[0])).toHaveLength(1);
    r.audio.dispose();
  });

  it("kolejna doba daje kolejne wilki", async () => {
    const r = rig();
    const start = await toMidnight(r);
    await play(r, 12, start);
    const next = FIRST_MIDNIGHT + SECONDS_PER_DAY - 5;
    r.audio.jumpClock(next);
    r.audio.setClock(next);
    await flush(1000);
    await play(r, 12, next);
    expect(wolves(r.ctxs[0])).toHaveLength(2);
    expect(r.audio.getDiagnostics().wolvesLastMidnight).toBe(1);
    r.audio.dispose();
  });

  it("ponowne wczytanie tej samej nocy (starszy zapis przed północą) nie powtarza wilków", async () => {
    const storage = new MemoryStorage();
    const first = rig({ storage });
    const start = await toMidnight(first);
    await play(first, 12, start);
    expect(wolves(first.ctxs[0])).toHaveLength(1);
    first.audio.dispose();

    const reload = rig({ storage });
    await toMidnight(reload);
    await play(reload, 12, start);
    expect(wolves(reload.ctxs[0])).toHaveLength(0);
    expect(reload.audio.getDiagnostics().lastMidnight?.result).toContain("zapis");
    reload.audio.dispose();

    const other = rig({ storage });
    await toMidnight(other, "inny-zapis");
    await play(other, 12, start);
    expect(wolves(other.ctxs[0])).toHaveLength(1);
    other.audio.dispose();
  });

  it("nie generuje zaległych wilków po skoku czasu w panelu dev ani po dużej zmianie czasu", async () => {
    const r = rig();
    r.audio.enter({ elapsed: at(23), saveId: "s" });
    await flush(1000);
    const target = FIRST_MIDNIGHT + 1 * H;
    r.audio.jumpClock(target);
    r.audio.setClock(target);
    await flush(12_000);
    expect(wolves(r.ctxs[0])).toHaveLength(0);
    const big = target + 3 * SECONDS_PER_DAY;
    r.audio.setClock(big);
    await flush(12_000);
    expect(wolves(r.ctxs[0])).toHaveLength(0);
    r.audio.dispose();
  });

  it("krótki zapowiedziany skok przez północ nie jest naturalnym przejściem", async () => {
    const r = rig();
    const start = FIRST_MIDNIGHT - 5;
    r.audio.enter({ elapsed: start, saveId: "s" });
    await flush(1000);
    r.audio.jumpClock(FIRST_MIDNIGHT + 5);
    r.audio.setClock(start + 0.1);
    r.audio.setClock(FIRST_MIDNIGHT + 5);
    await flush(12_000);
    expect(wolves(r.ctxs[0])).toHaveLength(0);
    r.audio.dispose();
  });

  it("wejście do lasu po północy nie odtwarza spóźnionych wilków", async () => {
    const r = rig();
    r.audio.enter({ elapsed: FIRST_MIDNIGHT + 3 * H, saveId: "s" });
    await flush(1000);
    await play(r, 20, FIRST_MIDNIGHT + 3 * H);
    expect(wolves(r.ctxs[0])).toHaveLength(0);
    r.audio.dispose();
  });

  it("jeśli gracza nie ma w lesie o północy, późniejsze wejście nie odtwarza wilków", async () => {
    const r = rig();
    const start = await toMidnight(r);
    r.audio.leave();
    await flush(1000);
    const later = FIRST_MIDNIGHT + 2 * H;
    r.audio.enter({ elapsed: later, saveId: "s" });
    await flush(1000);
    expect(wolves(r.ctxs[1])).toHaveLength(0);
    expect(start).toBeLessThan(later);
    r.audio.dispose();
  });

  it("nie odtwarza wilków, gdy karta jest w tle albo dźwięk jest zablokowany, i nie zapisuje północy", async () => {
    const hidden = rig();
    const start = await toMidnight(hidden);
    hidden.doc.hidden = true;
    hidden.doc.emit("visibilitychange");
    await play(hidden, 12, start);
    expect(wolves(hidden.ctxs[0])).toHaveLength(0);
    expect(hidden.audio.getDiagnostics().lastMidnight?.result).toContain("pominięte");
    expect(hidden.audio.getDiagnostics().wolvesLastMidnight).toBeNull();
    hidden.audio.dispose();

    const blocked = rig({ resumeAllowed: false });
    const s2 = await toMidnight(blocked);
    await play(blocked, 12, s2);
    expect(wolves(blocked.ctxs[0])).toHaveLength(0);
    expect(blocked.audio.getDiagnostics().wolvesLastMidnight).toBeNull();
    blocked.audio.dispose();
  });

  it("TEST WILKÓW gra efekt, ale nie zapisuje północy ani nie blokuje prawdziwych wilków", async () => {
    const r = rig();
    const start = await toMidnight(r);
    expect(r.audio.getDiagnostics().wolvesLastMidnight).toBeNull();
    expect(r.audio.testWolves()).toBe(true);
    await flush(500);
    expect(wolves(r.ctxs[0])).toHaveLength(1);
    expect(r.audio.getDiagnostics().wolvesLastMidnight).toBeNull();
    expect(r.audio.getDiagnostics().lastEffect?.kind).toBe("wolves-test");
    expect(r.audio.testWolves()).toBe(false);
    wolves(r.ctxs[0])[0].finish();
    await play(r, 12, start);
    expect(wolves(r.ctxs[0])).toHaveLength(2);
    expect(r.audio.getDiagnostics().wolvesLastMidnight).toBe(0);
    r.audio.dispose();
  });
});

describe("ForestAudioController: kroki", () => {
  const steps = (c: FakeContext) => sources(c).filter((s) => (s.buffer?.id === "synth" || s.buffer?.id === "footsteps.leaves") && !s.loop);

  async function walkFor(r: Rig, speed: number, seconds: number, startX = 0) {
    let x = startX;
    for (let t = 0; t < seconds; t += 0.05) {
      x += speed * 0.05;
      r.audio.setPose({ x, z: 0, yaw: 0 });
      await flush(50);
      for (const s of steps(r.ctxs[0])) if (!s.stopped) s.finish();
    }
    return x;
  }

  async function started(mode?: { dialog: boolean; frozen: boolean }) {
    const r = rig();
    if (mode) r.audio.setMode(mode);
    r.audio.enter({ elapsed: at(12), saveId: "s" });
    r.audio.setPose({ x: 0, z: 0, yaw: 0 });
    await flush(500);
    return r;
  }

  it("używa syntetycznego zastępnika, gdy nie ma pliku kroków, i oznacza to w diagnostyce", async () => {
    const r = await started();
    expect(r.audio.getDiagnostics().footsteps).toBe("syntetyczne (brak pliku)");
    r.audio.dispose();
  });

  it("używa segmentów z manifestu, gdy plik kroków istnieje", async () => {
    const manifest: AudioManifest = {
      ...TEST_MANIFEST,
      assets: {
        ...TEST_MANIFEST.assets,
        "footsteps.leaves": {
          id: "footsteps.leaves",
          role: "footsteps",
          channels: 1,
          loop: false,
          seconds: 3,
          frames: 144000,
          files: [{ url: "/audio/footsteps.leaves.ogg", type: 'audio/ogg; codecs="opus"', bytes: 1 }],
          steps: { kind: "sequence", segments: [{ start: 0.1, end: 0.4 }, { start: 1, end: 1.3 }, { start: 2, end: 2.25 }] },
        },
      },
    };
    const r = rig({ manifest });
    r.audio.enter({ elapsed: at(12), saveId: "s" });
    r.audio.setPose({ x: 0, z: 0, yaw: 0 });
    await flush(500);
    expect(r.audio.getDiagnostics().footsteps).toBe("próbki");
    await walkFor(r, 3.2, 3);
    const played = voices(r.ctxs[0], "footsteps.leaves");
    expect(played.length).toBeGreaterThan(3);
    for (const s of played) {
      const seg = [{ start: 0.1, end: 0.4 }, { start: 1, end: 1.3 }, { start: 2, end: 2.25 }].find((x) => x.start === s.started?.offset);
      expect(seg).toBeTruthy();
      expect(s.started?.duration).toBeCloseTo(seg!.end - seg!.start, 5);
    }
    expect(new Set(played.map((s) => s.started?.offset)).size).toBeGreaterThan(1);
    r.audio.dispose();
  });

  it("kroki są zsynchronizowane z ruchem: chód, bieg, stanie i obrót", async () => {
    const r = await started();
    await walkFor(r, 3.2, 5);
    const walking = steps(r.ctxs[0]).length;
    expect(walking).toBeGreaterThanOrEqual(10);
    expect(walking).toBeLessThanOrEqual(14);

    const run = await started();
    await walkFor(run, 5.6, 5);
    expect(steps(run.ctxs[0]).length).toBeGreaterThan(walking);

    const before = steps(r.ctxs[0]).length;
    for (let i = 0; i < 100; i++) {
      r.audio.setPose({ x: 16, z: 0, yaw: i * 0.2 });
      await flush(50);
    }
    expect(steps(r.ctxs[0]).length).toBe(before);
    expect(r.audio.getDiagnostics().walking).toBe(false);
    r.audio.dispose();
    run.audio.dispose();
  });

  it("zatrzymuje kroki w dialogu i przy blokadzie ruchu", async () => {
    for (const mode of [
      { dialog: true, frozen: true },
      { dialog: false, frozen: true },
    ]) {
      const r = await started(mode);
      await walkFor(r, 3.2, 5);
      expect(steps(r.ctxs[0])).toHaveLength(0);
      r.audio.setMode({ dialog: false, frozen: false });
      await walkFor(r, 3.2, 3, 20);
      expect(steps(r.ctxs[0]).length).toBeGreaterThan(3);
      r.audio.dispose();
    }
  });

  it("nie odtwarza kroków, gdy karta jest w tle", async () => {
    const r = await started();
    r.doc.hidden = true;
    r.doc.emit("visibilitychange");
    await walkFor(r, 3.2, 3);
    expect(steps(r.ctxs[0])).toHaveLength(0);
    r.audio.dispose();
  });
});

describe("ForestAudioController: ustawienia", () => {
  it("wyciszenie i głośności sterują węzłami i są zapamiętywane", async () => {
    const r = rig();
    r.audio.enter({ elapsed: at(12), saveId: "s" });
    await flush(100);
    const c = r.ctxs[0];
    const gains = () => c.nodes.filter((n): n is FakeGain => n instanceof FakeGain);
    r.audio.updateSettings({ master: 0.5 });
    expect(gains().some((g) => g.gain.target === 0.5)).toBe(true);
    r.audio.updateSettings({ muted: true });
    expect(gains().some((g) => g.gain.target === 0)).toBe(true);
    expect(r.audio.getDiagnostics().muted).toBe(true);
    r.audio.updateSettings({ ambience: 0.2, effects: 0.1 });
    r.audio.dispose();

    const again = rig({ storage: r.storage });
    expect(again.audio.getSettings()).toEqual({ master: 0.5, ambience: 0.2, effects: 0.1, muted: true });
    again.audio.dispose();
  });

  it("powiadamia subskrybentów tylko przy zmianie i zwraca stabilną referencję", () => {
    const r = rig();
    const fn = vi.fn();
    const off = r.audio.subscribe(fn);
    const a = r.audio.getSettings();
    expect(r.audio.getSettings()).toBe(a);
    r.audio.updateSettings({ master: 0.4 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(r.audio.getSettings()).not.toBe(a);
    off();
    r.audio.updateSettings({ master: 0.3 });
    expect(fn).toHaveBeenCalledTimes(1);
    r.audio.dispose();
  });
});

describe("ForestAudioController: autoplay, karta w tle, zasoby", () => {
  it("wznawia zablokowany kontekst po pierwszym geście i zdejmuje nasłuchy po zamknięciu", async () => {
    const r = rig({ resumeAllowed: false });
    r.audio.enter({ elapsed: at(12), saveId: "s" });
    await flush(1000);
    const c = r.ctxs[0];
    expect(c.state).toBe("suspended");
    expect(r.audio.getDiagnostics().contextState).toBe("suspended");
    expect(r.win.count()).toBeGreaterThan(0);
    c.allowResume = true;
    r.win.emit("pointerdown");
    await flush(10);
    expect(c.state).toBe("running");
    r.audio.dispose();
    expect(r.win.count()).toBe(0);
    expect(r.doc.count()).toBe(0);
  });

  it("wstrzymuje kontekst, gdy karta traci aktywność, i wznawia po powrocie", async () => {
    const r = rig();
    r.audio.enter({ elapsed: at(12), saveId: "s" });
    await flush(500);
    const c = r.ctxs[0];
    r.doc.hidden = true;
    r.doc.emit("visibilitychange");
    await flush(10);
    expect(c.state).toBe("suspended");
    expect(r.audio.getDiagnostics().contextState).toContain("tle");
    r.doc.hidden = false;
    r.doc.emit("visibilitychange");
    await flush(10);
    expect(c.state).toBe("running");
    r.audio.dispose();
  });

  it("wyjście z lasu zatrzymuje wszystko: źródła, węzły, kontekst i timery", async () => {
    const r = rig({ seed: 3 });
    r.audio.enter({ elapsed: at(12), saveId: "s" });
    r.audio.setPose({ x: 0, z: 0, yaw: 0 });
    await flush(1000);
    let elapsed = at(12);
    for (let i = 0; i < 1500; i++) {
      elapsed += 0.02;
      r.audio.setClock(elapsed);
      r.audio.setPose({ x: i * 0.05, z: 0, yaw: 0 });
      await flush(100);
    }
    const c = r.ctxs[0];
    expect(sources(c).length).toBeGreaterThan(5);
    r.audio.leave();
    expect(r.audio.active).toBe(false);
    await flush(2000);
    expect(c.state).toBe("closed");
    expect(sources(c).every((s) => s.disconnected && (s.stopped || !s.started))).toBe(true);
    expect(c.nodes.filter((n) => n.kind !== "destination").every((n) => n.disconnected)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(r.win.count()).toBe(0);
    expect(r.doc.count()).toBe(0);
    expect(r.audio.getDiagnostics().loaded).toEqual([]);
  });

  it("ponowne wejście tworzy nowy kontekst, a stary jest zamknięty; powtórne enter nie dubluje pętli", async () => {
    const r = rig();
    r.audio.enter({ elapsed: at(12), saveId: "s" });
    await flush(500);
    r.audio.enter({ elapsed: at(12), saveId: "s" });
    await flush(500);
    expect(r.ctxs).toHaveLength(1);
    expect(loops(r.ctxs[0])).toHaveLength(1);
    r.audio.leave();
    r.audio.enter({ elapsed: at(12) + 20, saveId: "s" });
    await flush(2000);
    expect(r.ctxs).toHaveLength(2);
    expect(r.ctxs[0].state).toBe("closed");
    expect(r.ctxs[1].state).toBe("running");
    expect(loops(r.ctxs[1])).toHaveLength(1);
    r.audio.dispose();
    expect(r.ctxs[1].state).toBe("closed");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("dispose podczas leave zwalnia natychmiast i nie zostawia timerów", async () => {
    const r = rig();
    r.audio.enter({ elapsed: at(12), saveId: "s" });
    await flush(500);
    r.audio.leave();
    r.audio.dispose();
    expect(r.ctxs[0].state).toBe("closed");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("brak Web Audio albo manifestu nie wywala gry i jest widoczny w diagnostyce", async () => {
    const broken = new ForestAudioController({
      createContext: () => {
        throw new Error("brak AudioContext");
      },
      storage: new MemoryStorage(),
    });
    expect(() => broken.enter({ elapsed: 0, saveId: "s" })).not.toThrow();
    expect(broken.getDiagnostics().error).toContain("brak AudioContext");
    expect(broken.active).toBe(false);
    expect(() => {
      broken.setClock(10);
      broken.setPose({ x: 0, z: 0, yaw: 0 });
      broken.setMode({ dialog: true, frozen: true });
      broken.jumpClock(100);
    }).not.toThrow();
    expect(broken.testWolves()).toBe(false);

    const noManifest = new ForestAudioController({
      createContext: () => new FakeContext() as unknown as AudioContext,
      fetch: (async () => ({ ok: false, status: 404 })) as unknown as typeof fetch,
      storage: new MemoryStorage(),
      document: new FakeTarget() as unknown as Document,
      window: new FakeTarget() as unknown as Window,
    });
    noManifest.enter({ elapsed: 0, saveId: "s" });
    await flush(500);
    expect(noManifest.getDiagnostics().error).toContain("404");
    noManifest.dispose();
  });

  it("wczytuje zasoby leniwie: przy wejściu w południe tylko dzienne tło, bez wilków i nocy", async () => {
    const r = rig();
    r.audio.enter({ elapsed: at(12), saveId: "s" });
    await flush(2000);
    const names = r.fetched.map((u) => u.replace("/audio/", ""));
    expect(names.some((n) => n.startsWith("ambience.day"))).toBe(true);
    expect(names.some((n) => n.startsWith("ambience.night"))).toBe(false);
    expect(names.some((n) => n.startsWith("event.wolves"))).toBe(false);
    expect(new Set(names.filter((n) => n.startsWith("ambience.day"))).size).toBe(1);
    r.audio.dispose();
  });

  it("wybiera format Opus, a przy błędzie dekodowania przechodzi na AAC", async () => {
    const r = rig();
    r.audio.enter({ elapsed: at(12), saveId: "s" });
    await flush(1000);
    expect(r.fetched).toContain("/audio/ambience.day.ogg");
    expect(r.fetched).not.toContain("/audio/ambience.day.m4a");
    r.audio.dispose();

    const ctx = new FakeContext();
    const original = ctx.decodeAudioData.bind(ctx);
    let calls = 0;
    ctx.decodeAudioData = async (data: ArrayBuffer) => {
      if (calls++ === 0) throw new Error("nie dekoduję");
      return original(data);
    };
    const fetched: string[] = [];
    const fallback = new ForestAudioController({
      createContext: () => ctx as unknown as AudioContext,
      fetch: fakeFetch(TEST_MANIFEST, fetched),
      rng: mulberry32(1),
      now: () => Date.now(),
      storage: new MemoryStorage(),
      canPlayType: () => "probably",
      document: new FakeTarget() as unknown as Document,
      window: new FakeTarget() as unknown as Window,
    });
    fallback.enter({ elapsed: at(12), saveId: "s" });
    await flush(1000);
    expect(fetched).toContain("/audio/ambience.day.ogg");
    expect(fetched).toContain("/audio/ambience.day.m4a");
    expect(ctx.sources.filter((s: FakeSource) => s.loop)).toHaveLength(1);
    fallback.dispose();
  });

  it("losowość audio nie dotyka generatora świata: nie używa Math.random, gdy wstrzyknięto własny generator", async () => {
    const spy = vi.spyOn(Math, "random");
    const r = rig({ seed: 9 });
    r.audio.enter({ elapsed: at(12), saveId: "s" });
    await flush(1000);
    let elapsed = at(12);
    for (let i = 0; i < 600; i++) {
      elapsed += 0.02;
      r.audio.setClock(elapsed);
      await flush(200);
    }
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    r.audio.dispose();
  });
});
