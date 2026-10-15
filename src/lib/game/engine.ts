/**
 * Publiczna fasada silnika gry. Implementacja jest podzielona na moduły
 * `core/` (stan, zegar, komendy, zdarzenia), `content/` (dane) i `systems/` (logika).
 */
export * from "./core/constants";
export * from "./core/clock";
export * from "./core/format";
export * from "./core/ids";
export * from "./core/rng";
export * from "./core/state";
export * from "./core/events";
export * from "./core/pause";
export * from "./core/apply";
export type { CommandResult } from "./core/result";
export * from "./content/items";
export * from "./content/houses";
export { generateHouse } from "./systems/houses";
export { drainPerSecond, isSheltered } from "./systems/vitals";
