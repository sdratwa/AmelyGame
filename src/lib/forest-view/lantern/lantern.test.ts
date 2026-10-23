import { describe, expect, it } from "vitest";
import {
  DEFAULT_LANTERN_CONFIG,
  LANTERN_PARAMS,
  candelaOf,
  changedKeys,
  cutoffOf,
  sanitizeLanternConfig,
  type LanternConfig,
} from "./config";
import { LANTERN_CONFIG_STORAGE_KEY, LanternConfigStore, parseConfigJson } from "./configStore";
import { glowPixels } from "./glow";
import {
  DAY_GLOW_FLOOR,
  GLOW_MAX_PIXELS,
  approach,
  attachTransform,
  baseLightColor,
  distanceWindow,
  flickerNoise,
  flickerSample,
  fogGlowFactor,
  glowDistanceFactor,
  glowOpacity,
  glowWorldSize,
  lanternIrradiance,
  lanternLod,
  lightFadeBand,
  lightScaleAt,
  nightFactor,
  pixelWorldAt1m,
  selectLightCandidates,
  shiftWarmth,
  terrainBlocks,
} from "./math";

const cfg = DEFAULT_LANTERN_CONFIG;

describe("konfiguracja lampy: domyślne wartości i zakresy", () => {
  it("domyślne wartości odpowiadają założeniom (barwa 2200 K ~ #FFBD55, promień 5 m, LOD 12/30 m, 150 m)", () => {
    expect(cfg.lightColor).toBe("#FFBD55");
    expect(cfg.temperatureK).toBe(2200);
    expect(cfg.radius).toBe(5);
    expect(cfg.nearDistance).toBe(12);
    expect(cfg.midDistance).toBe(30);
    expect(cfg.farGlowMaxDistance).toBe(150);
    expect(cfg.shadowsEnabled).toBe(false);
    expect(cfg.flickerEnabled).toBe(true);
  });

  it("każdy parametr ma opis, a wartość domyślna mieści się w jego zakresie", () => {
    const keys = new Set(Object.keys(cfg));
    for (const p of LANTERN_PARAMS) {
      expect(keys.has(p.key)).toBe(true);
      const v = cfg[p.key];
      if (p.kind === "number") {
        expect(typeof v).toBe("number");
        expect(v as number).toBeGreaterThanOrEqual(p.min);
        expect(v as number).toBeLessThanOrEqual(p.max);
        expect(p.min).toBeLessThan(p.max);
        expect(p.step).toBeGreaterThan(0);
      }
    }
    expect(new Set(LANTERN_PARAMS.map((p) => p.key)).size).toBe(LANTERN_PARAMS.length);
    expect(LANTERN_PARAMS.length).toBe(keys.size);
  });

  it("sanitize przycina do zakresów, odrzuca śmieci i naprawia kolejność progów", () => {
    const out = sanitizeLanternConfig({
      intensity: 9999,
      radius: -3,
      lightColor: "czerwony",
      glowColor: "#abcdef",
      flickerEnabled: "tak",
      shadowQuality: "ultra",
      nearDistance: 50,
      midDistance: 20,
      farGlowFadeStart: 200,
      farGlowFadeEnd: 100,
      maxLights: 2.6,
      nieznany: 5,
      attachX: Number.NaN,
    });
    expect(out.intensity).toBe(10);
    expect(out.radius).toBe(1);
    expect(out.lightColor).toBe(cfg.lightColor);
    expect(out.glowColor).toBe("#ABCDEF");
    expect(out.flickerEnabled).toBe(true);
    expect(out.shadowQuality).toBe("medium");
    expect(out.midDistance).toBeGreaterThan(out.nearDistance);
    expect(out.farGlowFadeEnd).toBeGreaterThan(out.farGlowFadeStart);
    expect(out.maxLights).toBe(3);
    expect(out.attachX).toBe(cfg.attachX);
    expect("nieznany" in out).toBe(false);
  });

  it("sanitize nie zmienia wejścia i zawsze zwraca nowy obiekt", () => {
    const input = { ...cfg };
    const out = sanitizeLanternConfig(input);
    expect(out).toEqual(cfg);
    expect(out).not.toBe(input);
    expect(sanitizeLanternConfig(null)).toEqual(cfg);
    expect(sanitizeLanternConfig([1, 2])).toEqual(cfg);
    expect(changedKeys(cfg)).toEqual([]);
    expect(changedKeys({ ...cfg, intensity: 2 })).toEqual(["intensity"]);
  });

  it("natężenie w kandelach i zasięg wynikają z parametrów", () => {
    expect(candelaOf({ intensity: 2, referenceDistance: 4, decay: 2 })).toBe(32);
    expect(cutoffOf({ radius: 5, fadeReach: 2 })).toBe(10);
  });
});

describe("zanik światła z odległością", () => {
  it("w odległości odniesienia (bez okna) natężenie równa się `intensity`; okno jest 1 przy źródle i 0 na zasięgu", () => {
    const wide = { ...cfg, fadeReach: 4, referenceDistance: 2, radius: 100 };
    expect(lanternIrradiance(2, wide)).toBeCloseTo(wide.intensity * distanceWindow(2, cutoffOf(wide)), 6);
    expect(distanceWindow(0, 10)).toBe(1);
    expect(distanceWindow(10, 10)).toBe(0);
    expect(distanceWindow(15, 10)).toBe(0);
  });

  it("jest ściśle malejący, nieujemny i bez skoków (gładkie wygaszanie bez twardej krawędzi)", () => {
    let prev = Infinity;
    const cutoff = cutoffOf(cfg);
    for (let d = 1; d <= cutoff + 1; d += 0.05) {
      const e = lanternIrradiance(d, cfg);
      expect(e).toBeGreaterThanOrEqual(0);
      expect(e).toBeLessThanOrEqual(prev + 1e-12);
      if (Number.isFinite(prev) && d < cutoff) expect(prev - e).toBeLessThan(prev * 0.2 + 0.05);
      prev = e;
    }
    expect(lanternIrradiance(cutoff, cfg)).toBe(0);
    // Brak twardej krawędzi: tuż przed zasięgiem światło jest już prawie zgaszone.
    expect(lanternIrradiance(cutoff * 0.98, cfg)).toBeLessThan(0.02 * lanternIrradiance(cfg.radius, cfg));
  });

  it("w promieniu silnego oświetlenia jest wyraźnie mocne, a daleko za nim słabe", () => {
    const inner = lanternIrradiance(cfg.radius, cfg);
    expect(inner).toBeGreaterThan(1);
    expect(lanternIrradiance(2.5, cfg)).toBeGreaterThan(inner);
    expect(lanternIrradiance(cutoffOf(cfg) * 0.9, cfg)).toBeLessThan(inner * 0.1);
  });

  it("odległość zero nie daje nieskończoności", () => {
    expect(Number.isFinite(lanternIrradiance(0, cfg))).toBe(true);
  });
});

describe("LOD lampy", () => {
  it("progi NEAR/MID/FAR (12 m i 30 m) i konfigurowalność", () => {
    expect(lanternLod(0, cfg)).toBe("near");
    expect(lanternLod(12, cfg)).toBe("near");
    expect(lanternLod(12.01, cfg)).toBe("mid");
    expect(lanternLod(30, cfg)).toBe("mid");
    expect(lanternLod(30.01, cfg)).toBe("far");
    expect(lanternLod(100, { nearDistance: 5, midDistance: 8 })).toBe("far");
    expect(lanternLod(6, { nearDistance: 5, midDistance: 8 })).toBe("mid");
  });

  it("mnożnik światła: 1 w NEAR, płynnie do skali MID, zero za pasmem wygaszania (FAR bez PointLight)", () => {
    expect(lightScaleAt(0, cfg)).toBe(1);
    expect(lightScaleAt(cfg.nearDistance, cfg)).toBe(1);
    expect(lightScaleAt(cfg.midDistance, cfg)).toBeCloseTo(cfg.midLightScale, 6);
    const end = cfg.midDistance + lightFadeBand(cfg);
    expect(lightScaleAt(end, cfg)).toBe(0);
    expect(lightScaleAt(end + 100, cfg)).toBe(0);
    let prev = 1;
    for (let d = 0; d <= end + 5; d += 0.25) {
      const s = lightScaleAt(d, cfg);
      expect(s).toBeLessThanOrEqual(prev + 1e-12);
      expect(prev - s).toBeLessThan(0.1);
      prev = s;
    }
  });

  it("wybór świateł: tylko dodatni mnożnik, lokalny pierwszy, potem najbliższe, limit liczby, stabilny remis", () => {
    const c = (id: string, distance: number, priority = false, scale = 1) => ({ id, distance, scale, priority });
    const out = selectLightCandidates([c("far", 25), c("near", 3), c("mine", 40, true), c("dead", 1, false, 0), c("tie-b", 10), c("tie-a", 10)], 4);
    expect(out.map((x) => x.id)).toEqual(["mine", "near", "tie-a", "tie-b"]);
    expect(selectLightCandidates([c("a", 1), c("b", 2)], 1).map((x) => x.id)).toEqual(["a"]);
    expect(selectLightCandidates([c("a", 1)], 0)).toEqual([]);
    expect(selectLightCandidates([], 3)).toEqual([]);
  });
});

describe("migotanie płomienia", () => {
  it("szum jest ograniczony do [-1, 1], deterministyczny i nie jest stały", () => {
    let min = 1;
    let max = -1;
    for (let t = 0; t < 120; t += 0.013) {
      const n = flickerNoise(t, 3.7);
      expect(n).toBeGreaterThanOrEqual(-1);
      expect(n).toBeLessThanOrEqual(1);
      expect(flickerNoise(t, 3.7)).toBe(n);
      min = Math.min(min, n);
      max = Math.max(max, n);
    }
    expect(max - min).toBeGreaterThan(1);
  });

  it("jest ciągły (bez gwałtownych skoków) i różny dla różnych lamp", () => {
    let maxStep = 0;
    for (let t = 0; t < 30; t += 1 / 60) maxStep = Math.max(maxStep, Math.abs(flickerSample(t + 1 / 60, 1, cfg).intensity - flickerSample(t, 1, cfg).intensity));
    // Przy 60 kl./s jasność zmienia się najwyżej o kilka procent na klatkę (brak błysków).
    expect(maxStep).toBeLessThan(0.03);
    expect(flickerNoise(2.2, 1)).not.toBe(flickerNoise(2.2, 2));
  });

  it("mnożnik natężenia pozostaje w granicach `1 ± intensity`, a wyłączone migotanie jest neutralne", () => {
    for (let t = 0; t < 60; t += 0.1) {
      const s = flickerSample(t, 5, cfg);
      expect(s.intensity).toBeGreaterThanOrEqual(1 - cfg.flickerIntensity - 1e-9);
      expect(s.intensity).toBeLessThanOrEqual(1 + cfg.flickerIntensity + 1e-9);
      expect(Math.abs(s.colorShift)).toBeLessThanOrEqual(cfg.flickerColorVariation + 1e-9);
    }
    expect(flickerSample(3, 5, { ...cfg, flickerEnabled: false })).toEqual({ intensity: 1, colorShift: 0 });
    expect(flickerSample(3, 5, { ...cfg, flickerIntensity: 0.5 }).intensity).toBeGreaterThanOrEqual(0.5);
  });

  it("szybkość skaluje czas, a przesunięcie barwy zostaje w [0, 1]", () => {
    const slow = flickerSample(1, 2, { ...cfg, flickerSpeed: 0.2 });
    const fast = flickerSample(1, 2, { ...cfg, flickerSpeed: 4 });
    expect(slow.intensity).not.toBe(fast.intensity);
    for (const sh of [-5, -1, 0, 1, 5]) for (const c of shiftWarmth([1, 0.74, 0.33], sh)) expect(c >= 0 && c <= 1).toBe(true);
  });

  it("barwa światła z koloru i z temperatury", () => {
    expect(baseLightColor(cfg)).toEqual([1, 189 / 255, 85 / 255]);
    const t = baseLightColor({ ...cfg, useTemperature: true, temperatureK: 2200 });
    expect(t[0]).toBe(1);
    expect(t[1]).toBeGreaterThan(t[2]);
    expect(baseLightColor({ ...cfg, useTemperature: true, temperatureK: 4000 })[2]).toBeGreaterThan(t[2]);
  });
});

describe("widoczność blasku z daleka", () => {
  it("rośnie i maleje zgodnie z zakresem: pełna blisko, słabnie, zero za maksymalnym dystansem (150 m)", () => {
    expect(glowDistanceFactor(10, cfg)).toBe(1);
    expect(glowDistanceFactor(60, cfg)).toBe(1);
    const at100 = glowDistanceFactor(100, cfg);
    const at140 = glowDistanceFactor(140, cfg);
    expect(at100).toBeGreaterThan(at140);
    expect(at140).toBeGreaterThan(0);
    expect(glowDistanceFactor(150, cfg)).toBe(0);
    expect(glowDistanceFactor(500, cfg)).toBe(0);
    let prev = 2;
    for (let d = 0; d <= 160; d += 1) {
      const f = glowDistanceFactor(d, cfg);
      expect(f).toBeLessThanOrEqual(prev + 1e-12);
      prev = f;
    }
  });

  it("odległości kontrolne 20/50/100/150 m: blask jest widoczny w nocy do 100 m, a na 150 m wygaszony", () => {
    const g = (distance: number) => glowOpacity(cfg, { distance, daylight: 0, fogDensity: 0, occlusion: 1, flicker: 1 });
    expect(g(20)).toBeCloseTo(cfg.glowOpacity, 6);
    expect(g(50)).toBeCloseTo(cfg.glowOpacity, 6);
    expect(g(100)).toBeGreaterThan(0.1);
    expect(g(149)).toBeGreaterThan(0);
    expect(g(150)).toBe(0);
  });

  it("wyłączony blask z daleka kończy się na strefie MID", () => {
    const off = { ...cfg, farGlowEnabled: false };
    expect(glowDistanceFactor(20, off)).toBeGreaterThan(0);
    expect(glowDistanceFactor(31, off)).toBe(0);
  });

  it("dzień osłabia blask, ale go nie wyłącza (lampa działa o każdej porze)", () => {
    expect(nightFactor(0)).toBe(1);
    expect(nightFactor(1)).toBe(DAY_GLOW_FLOOR);
    const base = { distance: 30, fogDensity: 0, occlusion: 1, flicker: 1 };
    expect(glowOpacity(cfg, { ...base, daylight: 1 })).toBeGreaterThan(0);
    expect(glowOpacity(cfg, { ...base, daylight: 1 })).toBeLessThan(glowOpacity(cfg, { ...base, daylight: 0 }));
  });

  it("mgła osłabia blask proporcjonalnie do `fogInteraction`, a nie wyłącza go (przy 0 nie ma wpływu)", () => {
    expect(fogGlowFactor(100, 0, 0.35)).toBe(1);
    expect(fogGlowFactor(100, 0.05, 0)).toBe(1);
    const thick = fogGlowFactor(100, 0.05, 0.35);
    expect(thick).toBeGreaterThan(0.6);
    expect(thick).toBeLessThan(1);
    expect(fogGlowFactor(100, 0.05, 1)).toBeLessThan(0.01);
    expect(fogGlowFactor(100, 0.05, 0.35)).toBeGreaterThan(fogGlowFactor(100, 0.05, 0.9));
  });

  it("zasłonięcie przez teren wygasza blask do zera, a wynik zawsze mieści się w [0, 1]", () => {
    const base = { distance: 80, daylight: 0, fogDensity: 0.01, flicker: 1.3 };
    expect(glowOpacity(cfg, { ...base, occlusion: 0 })).toBe(0);
    const v = glowOpacity({ ...cfg, glowOpacity: 1 }, { ...base, distance: 5, fogDensity: 0, occlusion: 1, flicker: 2 });
    expect(v).toBeLessThanOrEqual(1);
    expect(v).toBeGreaterThanOrEqual(0);
  });

  it("rozmiar blasku: minimum pikselowe z daleka, ograniczony od góry z bliska", () => {
    const px = pixelWorldAt1m((60 * Math.PI) / 180, 1080);
    const far = glowWorldSize(150, cfg, px);
    expect(far / (px * 150)).toBeCloseTo(Math.max(cfg.glowSize / (px * 150), cfg.farGlowMinPixelSize), 4);
    expect(far).toBeGreaterThanOrEqual(cfg.farGlowMinPixelSize * px * 150 - 1e-9);
    const near = glowWorldSize(1.5, cfg, px);
    expect(near / (px * 1.5)).toBeLessThanOrEqual(GLOW_MAX_PIXELS + 1e-6);
    for (const d of [0.5, 5, 30, 100, 150, 400]) {
      const size = glowWorldSize(d, cfg, px);
      expect(size).toBeGreaterThan(0);
      expect(size / (px * d)).toBeLessThanOrEqual(Math.max(GLOW_MAX_PIXELS, cfg.farGlowMinPixelSize) + 1e-6);
    }
  });

  it("tekstura blasku: miękki rdzeń, przezroczysty brzeg (brak widocznego kwadratu)", () => {
    const size = 32;
    const px = glowPixels(size);
    expect(px.length).toBe(size * size * 4);
    const alpha = (x: number, y: number) => px[(y * size + x) * 4 + 3];
    expect(alpha(15, 15)).toBeGreaterThan(200);
    for (let i = 0; i < size; i++) {
      expect(alpha(i, 0)).toBe(0);
      expect(alpha(0, i)).toBe(0);
      expect(alpha(i, size - 1)).toBe(0);
      expect(alpha(size - 1, i)).toBe(0);
    }
    expect(alpha(15, 15)).toBeGreaterThanOrEqual(alpha(15, 10));
    expect(alpha(15, 10)).toBeGreaterThanOrEqual(alpha(15, 4));
  });

  it("wygładzanie wykładnicze zbiega do celu niezależnie od kroku czasu", () => {
    expect(approach(0, 1, 0, 6)).toBe(0);
    const a = approach(approach(0, 1, 0.05, 6), 1, 0.05, 6);
    const b = approach(0, 1, 0.1, 6);
    expect(a).toBeCloseTo(b, 9);
    expect(approach(0, 1, 10, 6)).toBeCloseTo(1, 6);
  });
});

describe("zasłanianie terenem", () => {
  const flat = () => 0;
  const hill = (x: number) => (Math.abs(x - 50) < 10 ? 30 : 0);
  it("płaski teren nie zasłania, a wzgórze na linii wzroku tak", () => {
    const from = { x: 0, y: 2, z: 0 };
    const to = { x: 100, y: 1, z: 0 };
    expect(terrainBlocks(from, to, flat)).toBe(false);
    expect(terrainBlocks(from, to, (x) => hill(x))).toBe(true);
  });
  it("wzgórze poniżej linii wzroku (lampa wyżej) nie zasłania; krótkie odcinki są pomijane", () => {
    expect(terrainBlocks({ x: 0, y: 40, z: 0 }, { x: 100, y: 40, z: 0 }, (x) => hill(x))).toBe(false);
    expect(terrainBlocks({ x: 0, y: 2, z: 0 }, { x: 4, y: 1, z: 0 }, () => 999)).toBe(false);
  });
  it("wzgórze poza linią (z boku) nie zasłania", () => {
    expect(terrainBlocks({ x: 0, y: 2, z: 0 }, { x: 100, y: 1, z: 0 }, (x, z) => (Math.abs(z - 40) < 5 ? 50 : 0))).toBe(false);
  });
});

describe("mocowanie do dłoni", () => {
  it("kompensuje skalę rodzica, żeby lampa miała rozmiar w metrach", () => {
    const t = attachTransform(cfg, 1.55);
    expect(t.scale).toBeCloseTo(1 / 1.55, 9);
    expect(t.position[1]).toBeCloseTo(cfg.attachY / 1.55, 9);
    expect(t.rotation[0]).toBeCloseTo(Math.PI, 9);
    expect(attachTransform({ ...cfg, attachScale: 2 }, 2).scale).toBeCloseTo(1, 9);
    expect(attachTransform(cfg, 0).scale).toBe(cfg.attachScale);
  });
});

describe("magazyn konfiguracji (lokalny, bez wpływu na stan gry)", () => {
  class Mem {
    data = new Map<string, string>();
    getItem(k: string) {
      return this.data.get(k) ?? null;
    }
    setItem(k: string, v: string) {
      this.data.set(k, v);
    }
    removeItem(k: string) {
      this.data.delete(k);
    }
  }

  it("zmiany są przycinane do zakresów, powiadamiają i podnoszą rewizję", () => {
    const store = new LanternConfigStore(new Mem());
    let calls = 0;
    const off = store.subscribe(() => calls++);
    store.set({ intensity: 99, radius: 7 });
    expect(store.current.intensity).toBe(10);
    expect(store.current.radius).toBe(7);
    expect(calls).toBe(1);
    expect(store.revision).toBe(1);
    off();
    store.set({ radius: 6 });
    expect(calls).toBe(1);
  });

  it("Reset przywraca fabryczne, Set as default zapisuje lokalnie, Restore saved wraca do zapisanych", () => {
    const mem = new Mem();
    const store = new LanternConfigStore(mem);
    store.set({ intensity: 3 });
    expect(store.setAsDefault()).toBe(true);
    expect(mem.getItem(LANTERN_CONFIG_STORAGE_KEY)).toContain('"intensity": 3'.replace(": ", ":"));
    store.set({ intensity: 5 });
    store.restoreSaved();
    expect(store.current.intensity).toBe(3);
    store.reset();
    expect(store.current).toEqual(cfg);
    expect(store.saved?.intensity).toBe(3);
    expect(new LanternConfigStore(mem).current.intensity).toBe(3);
  });

  it("uszkodzony zapis lokalny jest ignorowany, a brak localStorage nie psuje działania", () => {
    const mem = new Mem();
    mem.setItem(LANTERN_CONFIG_STORAGE_KEY, "{nie json");
    expect(new LanternConfigStore(mem).current).toEqual(cfg);
    const none = new LanternConfigStore(null);
    none.set({ radius: 4 });
    expect(none.setAsDefault()).toBe(false);
    expect(none.current.radius).toBe(4);
  });

  it("JSON do schowka da się wczytać z powrotem (także sam obiekt konfiguracji) i nie przyjmuje śmieci", () => {
    const store = new LanternConfigStore(null);
    store.set({ decay: 1.7, lightColor: "#112233" });
    const text = store.toJson();
    const other = new LanternConfigStore(null);
    expect(other.fromJson(text)).toBe(true);
    expect(other.current).toEqual(store.current);
    expect(parseConfigJson(JSON.stringify({ intensity: 2 }))?.intensity).toBe(2);
    expect(parseConfigJson("[]")).toBeNull();
    expect(parseConfigJson("xx")).toBeNull();
    expect(other.fromJson("xx")).toBe(false);
  });

  it("konfiguracja wizualna nie zawiera nic z autorytatywnego stanu lampy", () => {
    const keys = Object.keys(cfg) as (keyof LanternConfig)[];
    expect(keys).not.toContain("enabled" as never);
    expect(keys).not.toContain("on" as never);
  });
});
