export type Rng = () => number;
export type AreaBounds = { minX: number; minZ: number; maxX: number; maxZ: number };

/** Największy ułamek promienia, na jaki kryjówka może się oddalić od środka okręgu (zawsze wyraźnie wewnątrz koła). */
export const AREA_EDGE_MARGIN = 0.95;
const MAX_TRIES = 48;

/**
 * Orientacyjny okrąg poszukiwań o promieniu `radius`, który zawsze zawiera kryjówkę `hide`, ale prawie nigdy nie ma jej
 * w środku: przesunięcie środka jest losowane równomiernie z POWIERZCHNI koła (`sqrt(u)`), więc kryjówka bywa blisko
 * każdej krawędzi. Środek może wyjść poza mapę najwyżej o pół promienia (minimapa i tak przycina rysunek); dzięki temu
 * kryjówka tuż przy granicy świata nie jest zdradzana środkiem okręgu. Gdy losowanie nie trafi w dozwolony obszar,
 * środek jest przycinany do tego obszaru - co zbliża go do kryjówki, więc zawieranie pozostaje gwarantowane.
 */
export function generateSearchArea(rng: Rng, hide: { x: number; z: number }, radius: number, bounds: AreaBounds): { x: number; z: number; r: number } {
  const pad = radius * 0.5;
  const lo = { x: bounds.minX - pad, z: bounds.minZ - pad };
  const hi = { x: bounds.maxX + pad, z: bounds.maxZ + pad };
  const inside = (x: number, z: number) => x >= lo.x && x <= hi.x && z >= lo.z && z <= hi.z;
  let cx = hide.x;
  let cz = hide.z;
  let found = false;
  let lastX = hide.x;
  let lastZ = hide.z;
  for (let i = 0; i < MAX_TRIES; i++) {
    const angle = rng() * Math.PI * 2;
    const dist = Math.sqrt(rng()) * radius * AREA_EDGE_MARGIN;
    lastX = hide.x + Math.cos(angle) * dist;
    lastZ = hide.z + Math.sin(angle) * dist;
    if (inside(lastX, lastZ)) {
      cx = lastX;
      cz = lastZ;
      found = true;
      break;
    }
  }
  if (!found) {
    cx = Math.min(hi.x, Math.max(lo.x, lastX));
    cz = Math.min(hi.z, Math.max(lo.z, lastZ));
  }
  return { x: cx, z: cz, r: radius };
}

/** Tasowanie Fishera-Yatesa na kopii (kolejność okręgów nie może zdradzać kolejności graczy). */
export function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
