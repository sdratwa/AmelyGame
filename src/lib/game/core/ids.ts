/**
 * Stabilne identyfikatory w formacie `rodzaj.nazwa` (np. `quest.bridge_01`,
 * `chest.bridge.pickaxe`). Logika nigdy nie opiera się na nazwach wyświetlanych.
 */
export type NamespacedId<Kind extends string> = `${Kind}.${string}`;

export type QuestId = NamespacedId<"quest">;
export type ChestId = NamespacedId<"chest">;
export type NpcId = NamespacedId<"npc">;
export type RegionId = NamespacedId<"region">;
export type BadgeId = NamespacedId<"badge">;
export type RecipeId = NamespacedId<"recipe">;
export type RiddleId = NamespacedId<"riddle">;
export type ContainerId = NamespacedId<"container">;
export type DepositId = NamespacedId<"deposit">;

/** Rodzaj identyfikatora (część przed pierwszą kropką) albo null, jeśli to nie ID z przestrzeni nazw. */
export function idKind(id: string): string | null {
  const dot = id.indexOf(".");
  if (dot <= 0 || dot === id.length - 1) return null;
  return id.slice(0, dot);
}

export function isIdOfKind<Kind extends string>(
  id: string,
  kind: Kind,
): id is NamespacedId<Kind> {
  return idKind(id) === kind;
}
