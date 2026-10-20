import { describe, expect, it } from "vitest";
import { AUDIO_SETTINGS_KEY, DEFAULT_AUDIO_SETTINGS, loadSettings, sanitizeSettings, saveSettings } from "./settings";
import { WolvesLedger, WOLVES_KEY } from "./wolvesLedger";
import { MemoryStorage } from "./testkit";

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
