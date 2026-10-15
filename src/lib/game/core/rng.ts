export type Rng = () => number;

/**
 * Kontrakt stabilności: dla tego samego ziarna ciąg wartości jest bitowo
 * identyczny we wszystkich wersjach gry (generatory świata i zapisy od niego zależą).
 * Nie zmieniaj algorytmu; potrzebny inny = nowa funkcja o nowej nazwie.
 */
export function mulberry32(seed: number): Rng {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a 32 bit: stabilny skrót tekstu na liczbę całkowitą bez znaku. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Ziarno strumienia zależne od ziarna bazowego i nazwy strumienia. */
export function streamSeed(seed: number, key: string): number {
  return hashString(`${seed >>> 0}:${key}`);
}

/**
 * Niezależny strumień liczb losowych dla danego ziarna i klucza (np. "river",
 * "chests", "houses"). Dodanie nowego strumienia nie przesuwa wartości pozostałych.
 */
export function rngStream(seed: number, key: string): Rng {
  return mulberry32(streamSeed(seed, key));
}
