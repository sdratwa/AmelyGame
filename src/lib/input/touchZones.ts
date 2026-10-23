/** Strefy ekranu dotykowego: lewa część to joystick ruchu, reszta to obrót kamery (przyciski akcji obsługują się same). */

export type TouchZone = "move" | "look";

/** Ułamek szerokości ekranu zajmowany przez strefę ruchu. */
export const MOVE_ZONE_FRACTION = 0.45;

export function touchZoneOf(x: number, width: number): TouchZone {
  if (!(width > 0) || !Number.isFinite(x)) return "look";
  return x / width < MOVE_ZONE_FRACTION ? "move" : "look";
}
