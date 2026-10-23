import type { Motion } from "./protocol";

export const PLAYER_COLLISION_RADIUS = 0.4;
const PLAYER_HEIGHT = 1.7;
const CROUCH_HEIGHT = 1.1;

/** Czy dwie pionowe kapsuły graczy zajmują wspólną przestrzeń. */
export function playersOverlap(a: Pick<Motion, "x" | "y" | "z" | "crouching">, b: Pick<Motion, "x" | "y" | "z" | "crouching">): boolean {
  return playersVerticallyOverlap(a, b) && Math.hypot(a.x - b.x, a.z - b.z) < PLAYER_COLLISION_RADIUS * 2;
}

export function playersVerticallyOverlap(a: Pick<Motion, "y" | "crouching">, b: Pick<Motion, "y" | "crouching">): boolean {
  const ah = a.crouching ? CROUCH_HEIGHT : PLAYER_HEIGHT;
  const bh = b.crouching ? CROUCH_HEIGHT : PLAYER_HEIGHT;
  return a.y < b.y + bh && b.y < a.y + ah;
}
