import { describe, expect, it } from "vitest";
import { TPP_DEFAULTS } from "./config";
import { clearTppOverrides, loadTppOverrides, resolveTppConfig, saveTppOverrides, TPP_STORAGE_KEY } from "./storedDefaults";

const memory = () => {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k), map };
};

describe("domyślne wartości TPP", () => {
  it("domyślne z kodu: skok 1,5 m, grawitacja 12, kamera 2,35 m", () => {
    expect(TPP_DEFAULTS.jumpHeight).toBe(1.5);
    expect(TPP_DEFAULTS.gravity).toBe(12);
    expect(TPP_DEFAULTS.cameraDistance).toBe(2.35);
  });

  it("zapis i odczyt własnych domyślnych (tylko różnice od kodu)", () => {
    const store = memory();
    expect(saveTppOverrides({ ...TPP_DEFAULTS, walkSpeed: 3, cameraDistance: 4 }, store)).toBe(true);
    expect(JSON.parse(store.map.get(TPP_STORAGE_KEY)!)).toEqual({ walkSpeed: 3, cameraDistance: 4 });
    expect(loadTppOverrides(store)).toEqual({ walkSpeed: 3, cameraDistance: 4 });
  });

  it("resolveTppConfig: to samo źródło dla gry i podglądu deweloperskiego (puste bez zapisu, a z zapisem własne wartości)", () => {
    const store = memory();
    expect(resolveTppConfig(store)).toEqual({});
    saveTppOverrides({ ...TPP_DEFAULTS, jumpHeight: 2 }, store);
    expect(resolveTppConfig(store)).toEqual(loadTppOverrides(store));
    expect(resolveTppConfig(store)).toEqual({ jumpHeight: 2 });
  });

  it("zapis wartości równych kodowi czyści wpis", () => {
    const store = memory();
    saveTppOverrides({ ...TPP_DEFAULTS, walkSpeed: 3 }, store);
    saveTppOverrides({ ...TPP_DEFAULTS }, store);
    expect(store.map.has(TPP_STORAGE_KEY)).toBe(false);
  });

  it("uszkodzone, obce i spoza zakresu dane są odrzucane lub przycinane; brak pamięci nie wywala", () => {
    const store = memory();
    store.setItem(TPP_STORAGE_KEY, "{nie json");
    expect(loadTppOverrides(store)).toEqual({});
    store.setItem(TPP_STORAGE_KEY, JSON.stringify({ walkSpeed: 999, nieznane: 1, runSpeed: "x" }));
    expect(loadTppOverrides(store)).toEqual({ walkSpeed: 5 });
    expect(loadTppOverrides(null)).toEqual({});
    expect(saveTppOverrides({ ...TPP_DEFAULTS }, null)).toBe(false);
    clearTppOverrides(store);
    expect(store.map.has(TPP_STORAGE_KEY)).toBe(false);
  });
});
