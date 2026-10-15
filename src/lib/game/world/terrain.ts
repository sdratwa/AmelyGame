import type { Bounds } from "./bounds";
import { fbm2 } from "./noise";
import { SegmentIndex } from "./polyline";
import type { Point, RibbonPoint } from "./shape";

export type Vec3 = { x: number; y: number; z: number };

/** Krok różnic centralnych (m) dla normalnych i nachylenia. */
export const NORMAL_EPS = 0.25;

/**
 * Wspólny interfejs wysokości terenu. Czysty i deterministyczny; bez React, Three i zegara.
 * `slope` zwraca stopnie, `gradient` to pochodne cząstkowe wysokości (tg nachylenia = |gradient|).
 */
export interface HeightField {
  height(x: number, z: number): number;
  normal(x: number, z: number): Vec3;
  slope(x: number, z: number): number;
  gradient(x: number, z: number): { dx: number; dz: number };
}

export interface Terrain extends HeightField {
  readonly seed: number;
  readonly version: number;
  readonly modifiers: readonly TerrainModifier[];
}

/** Buduje pełny interfejs z samej funkcji wysokości. */
export function makeField(height: (x: number, z: number) => number): HeightField {
  const gradient = (x: number, z: number) => ({
    dx: (height(x + NORMAL_EPS, z) - height(x - NORMAL_EPS, z)) / (2 * NORMAL_EPS),
    dz: (height(x, z + NORMAL_EPS) - height(x, z - NORMAL_EPS)) / (2 * NORMAL_EPS),
  });
  return {
    height,
    gradient,
    normal(x, z) {
      const g = gradient(x, z);
      const len = Math.hypot(g.dx, 1, g.dz);
      return { x: -g.dx / len, y: 1 / len, z: -g.dz / len };
    },
    slope(x, z) {
      const g = gradient(x, z);
      return (Math.atan(Math.hypot(g.dx, g.dz)) * 180) / Math.PI;
    },
  };
}

/** Modyfikacja terenu: lokalna, z jawnymi granicami wpływu, stosowana w ustalonej kolejności. */
export type TerrainModifier = {
  readonly id: string;
  readonly kind: string;
  readonly bounds: Bounds;
  apply(x: number, z: number, h: number): number;
};

const smoothstep = (t: number) => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

export type PadSpec = { id: string; x: number; z: number; radius: number; blend: number; height: number };

/**
 * Spłaszczenie pod budynek / obiekt questowy: wewnątrz `radius` stała wysokość `height`,
 * dalej gładkie wtapianie w teren na odcinku `blend`.
 */
export function padModifier(spec: PadSpec): TerrainModifier {
  const { id, x: cx, z: cz, radius, blend, height } = spec;
  const reach = radius + Math.max(0, blend);
  return {
    id,
    kind: "pad",
    bounds: { minX: cx - reach, minZ: cz - reach, maxX: cx + reach, maxZ: cz + reach },
    apply(x, z, h) {
      const d = Math.hypot(x - cx, z - cz);
      if (d >= reach) return h;
      if (d <= radius) return height;
      const t = smoothstep((d - radius) / blend);
      return height + (h - height) * t;
    },
  };
}

export type BumpSpec = { id: string; x: number; z: number; radius: number; amplitude: number };

/** Łagodne wzniesienie (amplitude > 0) albo zagłębienie (< 0) o profilu cosinusowym i zerowym wpływie poza `radius`. */
export function bumpModifier(spec: BumpSpec): TerrainModifier {
  const { id, x: cx, z: cz, radius, amplitude } = spec;
  return {
    id,
    kind: "bump",
    bounds: { minX: cx - radius, minZ: cz - radius, maxX: cx + radius, maxZ: cz + radius },
    apply(x, z, h) {
      const d = Math.hypot(x - cx, z - cz);
      if (d >= radius) return h;
      return h + amplitude * 0.5 * (1 + Math.cos((Math.PI * d) / radius));
    },
  };
}

export type RiverSpec = {
  id: string;
  /** Oś rzeki z półszerokością lustra wody `w` w każdym punkcie. */
  points: readonly RibbonPoint[];
  /** Wysokość lustra wody w każdym punkcie osi. */
  waterY: readonly number[];
  /** Głębokość koryta w osi (m) poniżej lustra wody. */
  depth: number;
  /** Szerokość skarpy brzegowej (m), na której teren wznosi się o `bankRise`. */
  bankWidth: number;
  bankRise: number;
  /** Odcinek (m), na którym wysokość brzegu wtapia się w teren naturalny. */
  blend: number;
};

/**
 * Koryto rzeki: wklęsłe dno w obrębie lustra wody, łagodna skarpa brzegowa i wtopienie w teren naturalny.
 * Profil jest ciągły, a jego nachylenie ograniczone parametrami (skarpa i wtopienie są rozciągnięte na kilka metrów).
 */
export function riverModifier(spec: RiverSpec): TerrainModifier {
  const { id, points, waterY, depth, bankWidth, bankRise, blend } = spec;
  if (points.length < 2 || waterY.length !== points.length) throw new Error(`Rzeka ${id}: niepoprawne punkty`);
  const reach = bankWidth + blend;
  const maxW = Math.max(...points.map((p) => p.w));
  const index = new SegmentIndex(reach, 24);
  index.addPolyline(points);
  const pad = maxW + reach;
  return {
    id,
    kind: "river",
    bounds: {
      minX: Math.min(...points.map((p) => p.x)) - pad,
      minZ: Math.min(...points.map((p) => p.z)) - pad,
      maxX: Math.max(...points.map((p) => p.x)) + pad,
      maxZ: Math.max(...points.map((p) => p.z)) + pad,
    },
    apply(x, z, h) {
      const hit = index.nearest(x, z);
      if (!hit) return h;
      const wy = waterY[hit.seg] + (waterY[hit.seg + 1] - waterY[hit.seg]) * hit.t;
      if (hit.gap <= 0) {
        const u = hit.d / hit.w;
        return wy - depth * (1 - u * u);
      }
      if (hit.gap < bankWidth) return wy + bankRise * smoothstep(hit.gap / bankWidth);
      const top = wy + bankRise;
      return top + (h - top) * smoothstep((hit.gap - bankWidth) / blend);
    },
  };
}

export type TrailSpec = {
  id: string;
  points: readonly Point[];
  /** Wysokość ścieżki w każdym punkcie osi (zwykle wygładzony profil terenu). */
  y: readonly number[];
  halfWidth: number;
  blend: number;
};

/** Ścieżka: stała wysokość w poprzek pasa (profil wzdłuż osi z `y`) i gładkie wtopienie w otoczenie na odcinku `blend`. */
export function trailModifier(spec: TrailSpec): TerrainModifier {
  const { id, points, y, halfWidth, blend } = spec;
  if (points.length < 2 || y.length !== points.length) throw new Error(`Ścieżka ${id}: niepoprawne punkty`);
  const index = new SegmentIndex(blend, 8);
  index.addPolyline(points.map((p) => ({ x: p.x, z: p.z, w: halfWidth })));
  const pad = halfWidth + blend;
  return {
    id,
    kind: "trail",
    bounds: {
      minX: Math.min(...points.map((p) => p.x)) - pad,
      minZ: Math.min(...points.map((p) => p.z)) - pad,
      maxX: Math.max(...points.map((p) => p.x)) + pad,
      maxZ: Math.max(...points.map((p) => p.z)) + pad,
    },
    apply(x, z, h) {
      const hit = index.nearest(x, z);
      if (!hit) return h;
      const yy = y[hit.seg] + (y[hit.seg + 1] - y[hit.seg]) * hit.t;
      if (hit.gap <= 0) return yy;
      return yy + (h - yy) * smoothstep(hit.gap / blend);
    },
  };
}

/**
 * Wersje terenu są niezmienne po wydaniu. Wersja 1 = płaski prototyp lasu.
 * Wersja 2 = ROBOCZA (przygotowanie pod generator W1a): nie jest zarejestrowana w generatorach
 * świata ani zapisywana; może się zmieniać do czasu wydania.
 */
type TerrainSpec = { amplitude: number; wavelength: number; octaves: number };
const TERRAIN_SPECS: Readonly<Record<number, TerrainSpec>> = {
  1: { amplitude: 0, wavelength: 1, octaves: 1 },
  2: { amplitude: 2.4, wavelength: 80, octaves: 3 },
};

export function hasTerrainVersion(version: number): boolean {
  return Object.prototype.hasOwnProperty.call(TERRAIN_SPECS, version);
}

/** Etap 1: bazowy teren wyłącznie z (seed, wersja). Nie zna żadnych obiektów ani modyfikacji. */
export function createBaseTerrain(worldSeed: number, worldGenVersion: number): Terrain {
  const spec = TERRAIN_SPECS[worldGenVersion];
  if (!spec) throw new Error(`Brak definicji terenu dla wersji generatora ${worldGenVersion}`);
  const seed = worldSeed >>> 0;
  const height =
    spec.amplitude === 0
      ? () => 0
      : (x: number, z: number) =>
          spec.amplitude * (2 * fbm2(seed, "terrain.base", x / spec.wavelength, z / spec.wavelength, spec.octaves) - 1);
  return { seed, version: worldGenVersion, modifiers: [], ...makeField(height) };
}

const CULL_CELL = 32;
const cellKey = (ix: number, iz: number) => `${ix},${iz}`;

/**
 * Etap 3: nakłada modyfikacje na teren bazowy w podanej kolejności. Modyfikacje są indeksowane
 * siatką, więc koszt zapytania zależy od liczby modyfikacji w pobliżu, nie od ich łącznej liczby.
 */
export function withModifiers(base: Terrain, modifiers: readonly TerrainModifier[]): Terrain {
  const ids = new Set<string>();
  for (const m of modifiers) {
    if (ids.has(m.id)) throw new Error(`Powtórzony identyfikator modyfikacji terenu: ${m.id}`);
    ids.add(m.id);
  }
  const cells = new Map<string, TerrainModifier[]>();
  for (const m of modifiers) {
    const x0 = Math.floor(m.bounds.minX / CULL_CELL);
    const x1 = Math.floor(m.bounds.maxX / CULL_CELL);
    const z0 = Math.floor(m.bounds.minZ / CULL_CELL);
    const z1 = Math.floor(m.bounds.maxZ / CULL_CELL);
    for (let iz = z0; iz <= z1; iz++) {
      for (let ix = x0; ix <= x1; ix++) {
        const key = cellKey(ix, iz);
        const list = cells.get(key);
        if (list) list.push(m);
        else cells.set(key, [m]);
      }
    }
  }
  const height = (x: number, z: number) => {
    let h = base.height(x, z);
    const list = cells.get(cellKey(Math.floor(x / CULL_CELL), Math.floor(z / CULL_CELL)));
    if (list) for (const m of list) h = m.apply(x, z, h);
    return h;
  };
  return { seed: base.seed, version: base.version, modifiers: [...base.modifiers, ...modifiers], ...makeField(height) };
}

/** Teren końcowy: baza z (seed, wersja) + opcjonalne modyfikacje. */
export function createTerrain(
  worldSeed: number,
  worldGenVersion: number,
  options: { modifiers?: readonly TerrainModifier[] } = {},
): Terrain {
  const base = createBaseTerrain(worldSeed, worldGenVersion);
  return options.modifiers && options.modifiers.length > 0 ? withModifiers(base, options.modifiers) : base;
}
