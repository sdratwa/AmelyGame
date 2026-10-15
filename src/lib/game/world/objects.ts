/**
 * Obiekty świata i ich kolizje. Dane kolizji należą do wersjonowanego modelu świata
 * (wynik generatora), nie zależą od wyglądu ani geometrii modeli GLB.
 */
export type Collider =
  | { shape: "circle"; r: number }
  | { shape: "box"; halfX: number; halfZ: number; yaw: number };

export type WorldObject = {
  /** Stabilny identyfikator, patrz `objectId`. */
  id: string;
  kind: string;
  x: number;
  z: number;
  /** Wysokość podstawy: wynik `terrain.height(x, z)` na terenie końcowym. */
  y: number;
  /** Wariant modelu w obrębie rodzaju (np. `common.3` dla `tree`); identyfikator modelu to `rodzaj.wariant`. */
  variant?: string;
  yaw?: number;
  scale?: number;
  /** Skala osi (x, y, z) zamiast jednolitej `scale` (np. skały o zmiennych proporcjach). */
  scaleXYZ?: readonly [number, number, number];
  /** Przechył (rad) wokół osi x i z. */
  tilt?: readonly [number, number];
  /** Promień obwiedni używany przez indeks przestrzenny; zawsze >= zasięg collidera. */
  radius: number;
  collider?: Collider;
  tags?: readonly string[];
};

export function colliderRadius(c: Collider): number {
  return c.shape === "circle" ? c.r : Math.hypot(c.halfX, c.halfZ);
}

export type ObjectInit = Omit<WorldObject, "radius"> & { radius?: number };

export function makeObject(init: ObjectInit): WorldObject {
  const bound = init.collider ? colliderRadius(init.collider) : 0;
  return { ...init, radius: Math.max(init.radius ?? 0, bound) };
}

/**
 * Wypycha okrąg gracza (px, pz, pr) z collidera obiektu. Zwraca nową pozycję i informację o trafieniu.
 * Deterministyczne: przy dokładnym pokryciu środków wypychanie następuje wzdłuż +x.
 */
export function pushOutOfCollider(
  obj: WorldObject,
  px: number,
  pz: number,
  pr: number,
): { x: number; z: number; hit: boolean } {
  const c = obj.collider;
  if (!c) return { x: px, z: pz, hit: false };
  if (c.shape === "circle") {
    const dx = px - obj.x;
    const dz = pz - obj.z;
    const min = c.r + pr;
    const d2 = dx * dx + dz * dz;
    if (d2 >= min * min) return { x: px, z: pz, hit: false };
    const d = Math.sqrt(d2);
    if (d < 1e-9) return { x: obj.x + min, z: obj.z, hit: true };
    return { x: obj.x + (dx / d) * min, z: obj.z + (dz / d) * min, hit: true };
  }
  const cos = Math.cos(c.yaw);
  const sin = Math.sin(c.yaw);
  const rx = px - obj.x;
  const rz = pz - obj.z;
  const lx = rx * cos - rz * sin;
  const lz = rx * sin + rz * cos;
  const cx = Math.max(-c.halfX, Math.min(c.halfX, lx));
  const cz = Math.max(-c.halfZ, Math.min(c.halfZ, lz));
  const dx = lx - cx;
  const dz = lz - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= pr * pr && !(dx === 0 && dz === 0)) return { x: px, z: pz, hit: false };
  let nx: number;
  let nz: number;
  if (dx === 0 && dz === 0) {
    const toX = c.halfX - Math.abs(lx);
    const toZ = c.halfZ - Math.abs(lz);
    if (toX <= toZ) {
      nx = (lx >= 0 ? c.halfX : -c.halfX) + (lx >= 0 ? pr : -pr);
      nz = lz;
    } else {
      nx = lx;
      nz = (lz >= 0 ? c.halfZ : -c.halfZ) + (lz >= 0 ? pr : -pr);
    }
  } else {
    const d = Math.sqrt(d2);
    nx = cx + (dx / d) * pr;
    nz = cz + (dz / d) * pr;
  }
  return { x: obj.x + nx * cos + nz * sin, z: obj.z - nx * sin + nz * cos, hit: true };
}
