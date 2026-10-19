import { describe, expect, it } from "vitest";
import { AUDIO_SETTINGS_KEY, DEFAULT_AUDIO_SETTINGS, loadSettings, sanitizeSettings, saveSettings } from "./settings";
import { WolvesLedger, WOLVES_KEY } from "./wolvesLedger";
import { synthFootstep, SYNTH_STEP_VARIANTS } from "./synth";
import { MemoryStorage, mulberry32 } from "./testkit";

describe("ustawienia audio", () => {
  it("domyślne, zapis i odczyt", () => {
    const st = new MemoryStorage();
    expect(loadSettings(st)).toEqual(DEFAULT_AUDIO_SETTINGS);
    saveSettings(st, { master: 0.3, ambience: 0.5, effects: 0.7, muted: true });
    expect(loadSettings(st)).toEqual({ master: 0.3, ambience: 0.5, effects: 0.7, muted: true });
  });

  it("psuty zapis i brak localStorage nie psują gry", () => {
    const st = new MemoryStorage();
    st.setItem(AUDIO_SETTINGS_KEY, "{nie json");
    expect(loadSettings(st)).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(loadSettings(null)).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(() => saveSettings(null, DEFAULT_AUDIO_SETTINGS)).not.toThrow();
    expect(sanitizeSettings({ master: 7, ambience: -1, effects: "x", muted: 1 })).toEqual({ master: 1, ambience: 0, effects: DEFAULT_AUDIO_SETTINGS.effects, muted: false });
  });
});

describe("WolvesLedger", () => {
  it("pamięta północ osobno dla każdego zapisu", () => {
    const l = new WolvesLedger(new MemoryStorage());
    expect(l.last("a")).toBeNull();
    l.record("a", 3);
    expect(l.last("a")).toBe(3);
    expect(l.last("b")).toBeNull();
    expect(l.played("a", 3)).toBe(true);
    expect(l.played("a", 2)).toBe(true);
    expect(l.played("a", 4)).toBe(false);
  });

  it("nie cofa numeru i ogranicza liczbę zapisów", () => {
    const st = new MemoryStorage();
    const l = new WolvesLedger(st);
    l.record("a", 5);
    l.record("a", 2);
    expect(l.last("a")).toBe(5);
    for (let i = 0; i < 20; i++) l.record(`s${i}`, i);
    expect(Object.keys(JSON.parse(st.getItem(WOLVES_KEY)!)).length).toBeLessThanOrEqual(8);
    expect(l.last("s19")).toBe(19);
  });

  it("psuty zapis i brak magazynu są obsłużone", () => {
    const st = new MemoryStorage();
    st.setItem(WOLVES_KEY, "###");
    expect(new WolvesLedger(st).last("a")).toBeNull();
    expect(() => new WolvesLedger(null).record("a", 1)).not.toThrow();
  });
});

describe("syntetyczne kroki", () => {
  it("są skończone, cichsze od pełnej skali i różne między wariantami", () => {
    const rng = mulberry32(1);
    const variants = Array.from({ length: SYNTH_STEP_VARIANTS }, () => synthFootstep(48000, rng));
    for (const v of variants) {
      expect(v.length).toBeGreaterThan(48000 * 0.2);
      let peak = 0;
      for (const x of v) {
        expect(Number.isFinite(x)).toBe(true);
        peak = Math.max(peak, Math.abs(x));
      }
      expect(peak).toBeGreaterThan(0.3);
      expect(peak).toBeLessThanOrEqual(0.8);
      expect(Math.abs(v[v.length - 1])).toBeLessThan(0.01);
    }
    expect(variants[0]).not.toEqual(variants[1]);
  });
});
