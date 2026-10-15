import { fingerprintOf } from "./fingerprint";
import { generateWorldV1 } from "./generators/v1";
import type { WorldBase } from "./types";

type Generator = (seed: number) => WorldBase;

/** Wersje generatora są niezmienne. Nowy układ świata = nowy numer wersji. */
const GENERATORS: Record<number, Generator> = {
  1: generateWorldV1,
};

export const CURRENT_GEN_VERSION = 1;

export function hasGenerator(version: number): boolean {
  return Object.prototype.hasOwnProperty.call(GENERATORS, version);
}

export function generateWorld(seed: number, version: number = CURRENT_GEN_VERSION): WorldBase {
  const generator = GENERATORS[version];
  if (!generator) throw new Error(`Nieznana wersja generatora świata: ${version}`);
  return generator(seed);
}

export function fingerprintWorld(base: WorldBase): string {
  return fingerprintOf(base);
}
