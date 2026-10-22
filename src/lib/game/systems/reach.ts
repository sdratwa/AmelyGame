import type { Collider, WorldObject } from "../world/objects";

/** Wysokość punktu interakcji nad podłożem (tułów postaci): niższe przeszkody nie zasłaniają celu. */
export const REACH_TORSO_HEIGHT = 0.9;
/** Obiekty, których środek leży bliżej celu niż tyle metrów, są uznawane za część celu (np. skrzynia przy pniu). */
export const REACH_TARGET_MARGIN = 0.8;
const RAY_PADDING = 0.04;

/** Wysokość (nad podłożem), do której obiekt zasłania linię: drzewa w całości, skały do ok. 2,6 m skali, reszta niska (jak w kamerze TPP). */
export function blockerTop(o: Pick<WorldObject, "kind" | "scale" | "scaleXYZ">): number {
  if (o.kind === "tree" || o.kind === "ancient") return 99;
  const scale = o.scaleXYZ?.[1] ?? o.scale ?? 1;
  if (o.kind === "rock") return 2.6 * scale;
  return 1.6;
}

export type ReachWorld = {
  collidersNear(x: number, z: number, r: number): readonly WorldObject[];
};

/** Odcinek (ax, az) -> (bx, bz) przecina okrąg o promieniu r (z marginesem) wokół (cx, cz)? */
function segmentHitsCircle(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, r: number): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const t = len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((cx - ax) * dx + (cz - az) * dz) / len2));
  const px = ax + dx * t - cx;
  const pz = az + dz * t - cz;
  return px * px + pz * pz < r * r;
}

/** Odcinek przecina prostokąt (obrócony o yaw) powiększony o `pad`? Obcinanie odcinka do prostokąta w układzie lokalnym. */
function segmentHitsBox(ax: number, az: number, bx: number, bz: number, o: WorldObject, c: Extract<Collider, { shape: "box" }>, pad: number): boolean {
  const cos = Math.cos(c.yaw);
  const sin = Math.sin(c.yaw);
  const toLocal = (x: number, z: number): [number, number] => {
    const rx = x - o.x;
    const rz = z - o.z;
    return [rx * cos - rz * sin, rx * sin + rz * cos];
  };
  const [x0, z0] = toLocal(ax, az);
  const [x1, z1] = toLocal(bx, bz);
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-12) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  const dx = x1 - x0;
  const dz = z1 - z0;
  const hx = c.halfX + pad;
  const hz = c.halfZ + pad;
  return clip(-dx, x0 + hx) && clip(dx, hx - x0) && clip(-dz, z0 + hz) && clip(dz, hz - z0) && t0 <= t1;
}

/**
 * Czy między postacią a celem nie stoi przeszkoda (drzewo, skała, ściana, obiekt z kolizją wyższy niż tułów)? Sprawdzenie
 * jest płaskie (x-z), dokładne dla okręgów i prostokątów. Pomija obiekt `ignoreId` (sam cel) oraz obiekty tak blisko
 * celu, że są jego częścią. Czysta funkcja: nic nie zmienia i nie zależy od kamery.
 */
export function isReachClear(
  world: ReachWorld,
  from: { x: number; z: number },
  to: { x: number; z: number },
  ignoreId?: string,
  torsoHeight = REACH_TORSO_HEIGHT,
): boolean {
  const len = Math.hypot(to.x - from.x, to.z - from.z);
  if (len < 1e-6) return true;
  const mx = (from.x + to.x) / 2;
  const mz = (from.z + to.z) / 2;
  for (const o of world.collidersNear(mx, mz, len / 2 + 0.5)) {
    if (!o.collider || o.id === ignoreId) continue;
    if (Math.hypot(o.x - to.x, o.z - to.z) < REACH_TARGET_MARGIN) continue;
    if (blockerTop(o) <= torsoHeight) continue;
    const c = o.collider;
    const hit =
      c.shape === "circle"
        ? segmentHitsCircle(from.x, from.z, to.x, to.z, o.x, o.z, c.r + RAY_PADDING)
        : segmentHitsBox(from.x, from.z, to.x, to.z, o, c, RAY_PADDING);
    if (hit) return false;
  }
  return true;
}
