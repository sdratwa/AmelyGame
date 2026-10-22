import { describe, expect, it } from "vitest";
import { CATALOG, DEFAULT_APPEARANCE, SLOTS, findItem, glbFileForLod, glbLods, itemsOfSlot, normalizeAppearance, sameAppearance, withAppearance } from "./index";

describe("wygląd postaci: dane", () => {
  it("domyślny wygląd jest poprawny i wskazuje istniejące elementy rejestru", () => {
    expect(normalizeAppearance(DEFAULT_APPEARANCE)).toEqual(DEFAULT_APPEARANCE);
    expect(findItem(DEFAULT_APPEARANCE.hairStyleId!, "hair")).toBeDefined();
    expect(findItem(DEFAULT_APPEARANCE.topId!, "top")).toBeDefined();
    expect(findItem(DEFAULT_APPEARANCE.bottomId!, "bottom")).toBeDefined();
  });

  it("normalizacja nie rzuca na śmieciowych danych i zwraca poprawny obiekt", () => {
    for (const bad of [null, undefined, 5, "x", [], { hairStyleId: 7, hairColor: "red", topId: "top.99", bottomColor: "#12" }]) {
      const a = normalizeAppearance(bad);
      expect(a.baseId).toBe(DEFAULT_APPEARANCE.baseId);
      expect(a.hairColor).toMatch(/^#[0-9a-f]{6}$/);
      expect(a.topColor).toMatch(/^#[0-9a-f]{6}$/);
      expect(a.bottomColor).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("nieznany element w slocie daje null (puste miejsce), zły typ wraca do domyślnego, zły kolor do domyślnego", () => {
    const a = normalizeAppearance({ ...DEFAULT_APPEARANCE, topId: "top.99", hairStyleId: 3, bottomColor: "zielony" });
    expect(a.topId).toBeNull();
    expect(a.hairStyleId).toBe(DEFAULT_APPEARANCE.hairStyleId);
    expect(a.bottomColor).toBe(DEFAULT_APPEARANCE.bottomColor);
  });

  it("jawne null oznacza brak elementu; element ze złego slotu jest odrzucany", () => {
    expect(normalizeAppearance({ ...DEFAULT_APPEARANCE, hairStyleId: null }).hairStyleId).toBeNull();
    expect(normalizeAppearance({ ...DEFAULT_APPEARANCE, hairStyleId: "top.01" }).hairStyleId).toBeNull();
  });

  it("kolory są sprowadzane do małych liter; withAppearance nie zmienia wejścia; sameAppearance porównuje strukturalnie", () => {
    const a = withAppearance(DEFAULT_APPEARANCE, { topColor: "#ABCDEF" });
    expect(a.topColor).toBe("#abcdef");
    expect(DEFAULT_APPEARANCE.topColor).not.toBe("#abcdef");
    expect(sameAppearance(a, { ...a })).toBe(true);
    expect(sameAppearance(a, DEFAULT_APPEARANCE)).toBe(false);
  });
});

describe("rejestr elementów", () => {
  it("ID są unikalne, stabilne (`slot.NN` albo opisowe `hair_tripo_short_01`) i zgodne ze slotem", () => {
    const ids = CATALOG.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of CATALOG) {
      expect(item.id).toMatch(/^(hair|top|bottom|shoes)[._][a-z0-9_]+$/);
      expect(item.id.startsWith(`${item.slot}.`) || item.id.startsWith(`${item.slot}_`)).toBe(true);
      expect(SLOTS).toContain(item.slot);
      expect(item.triangleBudget).toBeGreaterThan(0);
    }
  });

  it("wymagane elementy z planu istnieją: dwie fryzury, góra i dół", () => {
    expect(itemsOfSlot("hair").map((i) => i.id)).toEqual(expect.arrayContaining(["hair.01", "hair.02"]));
    expect(itemsOfSlot("top").map((i) => i.id)).toContain("top.01");
    expect(itemsOfSlot("bottom").map((i) => i.id)).toContain("bottom.01");
  });

  it("ubrania mają reguły ukrywania ciała, fryzury nie; element bez zasobu nie udaje gotowego", () => {
    for (const item of CATALOG) {
      if (item.slot === "top" || item.slot === "bottom") expect(item.hides?.length ?? 0).toBeGreaterThan(0);
      if (item.slot === "hair") expect(item.hides).toBeUndefined();
      // GLB bez pliku w repozytorium musi mieć status missing_asset; gotowy GLB wskazuje plik istniejący na dysku (test fryzury GLB).
      if (item.source.kind === "glb" && item.status === "missing_asset") expect(item.note).toBeTruthy();
    }
  });

  it("fryzura Tripo3D: wpis w rejestrze z metadanymi i strukturą LOD (tylko LOD0)", () => {
    const item = findItem("hair_tripo_short_01", "hair");
    expect(item).not.toBeNull();
    expect(item!.name).toBe("Krótkie, naturalne");
    expect(item!.origin).toBe("Tripo3D");
    expect(item!.category).toBe("Short");
    expect(item!.availableFor).toEqual(["female"]);
    expect(item!.defaultColor).toBe("#ffffff");
    expect(item!.source.kind).toBe("glb");
    expect(item!.status).toBe("ready");
    expect(glbLods(item!)).toEqual([{ level: 0, file: "hair/Miasto_Fryzura_HeadLocal_Wstepne_Dopasowanie.glb" }]);
    // Brak uproszczonych poziomów: każdy poziom wraca do oryginału.
    for (const level of [0, 1, 2] as const) expect(glbFileForLod(item!, level)).toBe("hair/Miasto_Fryzura_HeadLocal_Wstepne_Dopasowanie.glb");
    expect(glbFileForLod(findItem("hair.01")!)).toBeNull();
  });

  it("LOD: poziom wybiera najbliższy dostępny niższy lub równy", () => {
    const base = findItem("hair_tripo_short_01")!;
    const withLods = { ...base, source: { ...(base.source as Extract<typeof base.source, { kind: "glb" }>), lods: [{ level: 1 as const, file: "l1.glb" }, { level: 2 as const, file: "l2.glb" }] } };
    expect(glbFileForLod(withLods, 0)).toBe(base.source.kind === "glb" ? base.source.file : "");
    expect(glbFileForLod(withLods, 1)).toBe("l1.glb");
    expect(glbFileForLod(withLods, 2)).toBe("l2.glb");
  });

  it("zmiana fryzury przenosi kolor domyślny nowej fryzury, ale nie nadpisuje koloru wybranego przez gracza", () => {
    const toTripo = withAppearance(DEFAULT_APPEARANCE, { hairStyleId: "hair_tripo_short_01" });
    expect(toTripo.hairStyleId).toBe("hair_tripo_short_01");
    expect(toTripo.hairColor).toBe("#ffffff");
    expect(withAppearance(toTripo, { hairStyleId: "hair.02" }).hairColor).toBe(DEFAULT_APPEARANCE.hairColor);
    const custom = withAppearance({ ...DEFAULT_APPEARANCE }, { hairColor: "#aa3366" });
    expect(withAppearance(custom, { hairStyleId: "hair_tripo_short_01" }).hairColor).toBe("#aa3366");
    expect(withAppearance(toTripo, { hairStyleId: "hair.01", hairColor: "#112233" }).hairColor).toBe("#112233");
  });

  it("zapis z ID fryzury Tripo3D przechodzi normalizację", () => {
    expect(normalizeAppearance({ ...DEFAULT_APPEARANCE, hairStyleId: "hair_tripo_short_01", hairColor: "#FFFFFF" })).toMatchObject({ hairStyleId: "hair_tripo_short_01", hairColor: "#ffffff" });
  });
});
