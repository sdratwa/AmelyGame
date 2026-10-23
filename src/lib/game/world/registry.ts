import { fingerprintOf } from "./fingerprint";
import { generateWorldV1 } from "./generators/v1";
import { generateWorldV2 } from "./generators/v2/world";
import { generateWorldV3 } from "./generators/v3/world";
import { generateWorldV4 } from "./generators/v4/world";
import type { WorldBase } from "./types";

type Generator = (seed: number) => WorldBase;

/** Wersje generatora są niezmienne. Nowy układ świata = nowy numer wersji. */
const GENERATORS: Record<number, Generator> = {
  1: generateWorldV1,
  2: generateWorldV2,
  3: generateWorldV3,
  4: generateWorldV4,
};

/** Nowe gry: v3 (las z paczką Pro). Zapisy v2 nadal działają na zamrożonym generatorze v2. */
export const CURRENT_GEN_VERSION = 4;

const CACHE_LIMIT = 6;
const cache = new Map<string, WorldBase>();

export function hasGenerator(version: number): boolean {
  return Object.prototype.hasOwnProperty.call(GENERATORS, version);
}

export function generateWorld(seed: number, version: number = CURRENT_GEN_VERSION): WorldBase {
  const generator = GENERATORS[version];
  if (!generator) throw new Error(`Nieznana wersja generatora świata: ${version}`);
  const key = `${version}:${seed >>> 0}`;
  const hit = cache.get(key);
  if (hit) return structuredClone(hit);
  const base = generator(seed);
  cache.set(key, base);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  return structuredClone(base);
}

export function fingerprintWorld(base: WorldBase): string {
  return fingerprintOf(base);
}
