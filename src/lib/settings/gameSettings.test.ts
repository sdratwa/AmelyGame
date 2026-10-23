import { describe, expect, it, vi } from "vitest";
import { DEFAULT_GAME_SETTINGS, GAME_SETTINGS_KEY, GameSettingsStore, normalizeGameSettings, parseGameSettings } from "./gameSettings";

function memoryStorage(initial?: string) {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(GAME_SETTINGS_KEY, initial);
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

describe("ustawienia gry", () => {
  it("domyślnie nazwy graczy są widoczne", () => {
    expect(DEFAULT_GAME_SETTINGS.showPlayerNames).toBe(true);
    expect(new GameSettingsStore(() => memoryStorage()).get().showPlayerNames).toBe(true);
  });

  it("uszkodzone i nieprawidłowe dane wracają do domyślnych", () => {
    expect(parseGameSettings("{nie json")).toEqual(DEFAULT_GAME_SETTINGS);
    expect(parseGameSettings(null)).toEqual(DEFAULT_GAME_SETTINGS);
    expect(normalizeGameSettings({ showPlayerNames: "nie" })).toEqual(DEFAULT_GAME_SETTINGS);
    expect(normalizeGameSettings(42)).toEqual(DEFAULT_GAME_SETTINGS);
  });

  it("zapisuje i odczytuje wyłączenie nazw (round-trip)", () => {
    const storage = memoryStorage();
    new GameSettingsStore(() => storage).set({ showPlayerNames: false });
    expect(JSON.parse(storage.data.get(GAME_SETTINGS_KEY)!)).toEqual({ showPlayerNames: false, hideSeekMinutes: 5 });
    expect(new GameSettingsStore(() => storage).get().showPlayerNames).toBe(false);
  });

  it("powiadamia subskrybentów, zwraca nowy snapshot i pozwala wrócić do domyślnych", () => {
    const store = new GameSettingsStore(() => memoryStorage());
    const cb = vi.fn();
    const off = store.subscribe(cb);
    const before = store.get();
    store.set({ showPlayerNames: false });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(store.get()).not.toBe(before);
    store.reset();
    expect(store.get().showPlayerNames).toBe(true);
    off();
    store.set({ showPlayerNames: false });
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("czas poszukiwań w chowanego: domyślnie 5 min, przycinany do 1-15", () => {
    expect(DEFAULT_GAME_SETTINGS.hideSeekMinutes).toBe(5);
    expect(normalizeGameSettings({ hideSeekMinutes: 99 }).hideSeekMinutes).toBe(15);
    expect(normalizeGameSettings({ hideSeekMinutes: 0 }).hideSeekMinutes).toBe(1);
    expect(normalizeGameSettings({ hideSeekMinutes: "dużo" }).hideSeekMinutes).toBe(5);
    const store = new GameSettingsStore(() => memoryStorage());
    store.set({ hideSeekMinutes: 8 });
    expect(store.get().hideSeekMinutes).toBe(8);
  });

  it("brak dostępu do magazynu nie psuje ustawień", () => {
    const store = new GameSettingsStore(() => null);
    store.set({ showPlayerNames: false });
    expect(store.get().showPlayerNames).toBe(false);
    const broken = new GameSettingsStore(() => ({
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    }));
    expect(broken.get()).toEqual(DEFAULT_GAME_SETTINGS);
    expect(() => broken.set({ showPlayerNames: false })).not.toThrow();
  });
});
