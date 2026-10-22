import { findItem } from "./registry";

/** Postać bazowa, na której działa personalizacja (jedyna grywalna dziś: dziewczynka). */
export const PLAYER_GIRL_BASE_ID = "player.girl.base";

/**
 * Wygląd postaci jako dane: żadnej logiki sterowania ani JSX. Wersja 1; nowe pola (kolor skóry i oczu, buty) dojdą jako
 * opcjonalne, razem z wersją zapisu. ID elementów są stabilne i pochodzą z rejestru (`CATALOG`).
 */
export type CharacterAppearanceV1 = {
  baseId: string;
  hairStyleId: string | null;
  hairColor: string;
  topId: string | null;
  topColor: string;
  bottomId: string | null;
  bottomColor: string;
};

export const DEFAULT_APPEARANCE: Readonly<CharacterAppearanceV1> = {
  baseId: PLAYER_GIRL_BASE_ID,
  hairStyleId: "hair.01",
  hairColor: "#5b3a22",
  topId: "top.01",
  topColor: "#4f8f5a",
  bottomId: "bottom.01",
  bottomColor: "#6a4e38",
};

const HEX = /^#[0-9a-fA-F]{6}$/;
export const isHexColor = (v: unknown): v is string => typeof v === "string" && HEX.test(v);

/**
 * Bezpieczny wygląd z dowolnych danych (zapis, JSON z panelu): zawsze zwraca poprawny obiekt. Nieznany element w slocie
 * (np. usunięty z gry) daje `null` w tym slocie, zły kolor wraca do domyślnego. Nigdy nie rzuca.
 */
export function normalizeAppearance(input: unknown): CharacterAppearanceV1 {
  const r = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const d = DEFAULT_APPEARANCE;
  const pick = (value: unknown, slot: "hair" | "top" | "bottom", fallback: string | null): string | null => {
    if (value === null) return null;
    if (typeof value !== "string") return fallback;
    return findItem(value, slot) ? value : null;
  };
  return {
    baseId: typeof r.baseId === "string" && r.baseId === PLAYER_GIRL_BASE_ID ? r.baseId : d.baseId,
    hairStyleId: pick(r.hairStyleId, "hair", d.hairStyleId),
    hairColor: isHexColor(r.hairColor) ? r.hairColor.toLowerCase() : d.hairColor,
    topId: pick(r.topId, "top", d.topId),
    topColor: isHexColor(r.topColor) ? r.topColor.toLowerCase() : d.topColor,
    bottomId: pick(r.bottomId, "bottom", d.bottomId),
    bottomColor: isHexColor(r.bottomColor) ? r.bottomColor.toLowerCase() : d.bottomColor,
  };
}

/** Strukturalna równość (do pomijania zbędnych przebudów). */
export function sameAppearance(a: CharacterAppearanceV1, b: CharacterAppearanceV1): boolean {
  return (
    a.baseId === b.baseId &&
    a.hairStyleId === b.hairStyleId &&
    a.hairColor === b.hairColor &&
    a.topId === b.topId &&
    a.topColor === b.topColor &&
    a.bottomId === b.bottomId &&
    a.bottomColor === b.bottomColor
  );
}

/** Kolor domyślny fryzury: z rejestru (np. biały = oryginał fryzury GLB) albo domyślny kolor włosów. */
export const defaultHairColor = (hairStyleId: string | null): string => findItem(hairStyleId, "hair")?.defaultColor ?? DEFAULT_APPEARANCE.hairColor;

/**
 * Wygląd z podmienionymi polami (nie zmienia wejścia). Przy zmianie fryzury bez jawnego koloru: jeśli kolor włosów nadal
 * jest domyślny dla poprzedniej fryzury (gracz go nie zmieniał), przechodzi na domyślny kolor nowej (np. oryginalny kolor
 * fryzury GLB); własny kolor gracza zostaje.
 */
export const withAppearance = (a: CharacterAppearanceV1, patch: Partial<CharacterAppearanceV1>): CharacterAppearanceV1 => {
  const merged = { ...a, ...patch };
  if (patch.hairStyleId !== undefined && patch.hairStyleId !== a.hairStyleId && patch.hairColor === undefined && a.hairColor === defaultHairColor(a.hairStyleId)) {
    merged.hairColor = defaultHairColor(patch.hairStyleId);
  }
  return normalizeAppearance(merged);
};
