export type Vec3 = [number, number, number];

/** Geometria w tablicach płaskich (bez three): wynik generatorów fryzur i ubrań. */
export type MeshData = {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  /** Tylko ubrania: indeksy i wagi kości (4 na wierzchołek), w przestrzeni indeksów kości bazowego szkieletu. */
  skinIndex?: Uint16Array;
  skinWeight?: Float32Array;
};

export const triangleCount = (m: Pick<MeshData, "indices">) => m.indices.length / 3;

/**
 * Wygładzone normalne z uśrednieniem po położeniu (wierzchołki o tej samej pozycji, np. na szwach UV, dostają tę samą
 * normalną, więc nie ma pęknięć oświetlenia). Wagi proporcjonalne do pola trójkąta.
 */
export function smoothNormals(positions: ArrayLike<number>, indices: ArrayLike<number>, weldDecimals = 5): Float32Array {
  const n = positions.length / 3;
  const scale = 10 ** weldDecimals;
  const key = (i: number) => `${Math.round(positions[i * 3] * scale)},${Math.round(positions[i * 3 + 1] * scale)},${Math.round(positions[i * 3 + 2] * scale)}`;
  const group = new Map<string, number>();
  const groupOf = new Int32Array(n);
  let groups = 0;
  for (let i = 0; i < n; i++) {
    const k = key(i);
    let g = group.get(k);
    if (g === undefined) {
      g = groups++;
      group.set(k, g);
    }
    groupOf[i] = g;
  }
  const acc = new Float64Array(groups * 3);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t];
    const b = indices[t + 1];
    const c = indices[t + 2];
    const ux = positions[b * 3] - positions[a * 3];
    const uy = positions[b * 3 + 1] - positions[a * 3 + 1];
    const uz = positions[b * 3 + 2] - positions[a * 3 + 2];
    const vx = positions[c * 3] - positions[a * 3];
    const vy = positions[c * 3 + 1] - positions[a * 3 + 1];
    const vz = positions[c * 3 + 2] - positions[a * 3 + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      const g = groupOf[v] * 3;
      acc[g] += nx;
      acc[g + 1] += ny;
      acc[g + 2] += nz;
    }
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const g = groupOf[i] * 3;
    const len = Math.hypot(acc[g], acc[g + 1], acc[g + 2]);
    if (len < 1e-12) {
      out[i * 3 + 1] = 1;
    } else {
      out[i * 3] = acc[g] / len;
      out[i * 3 + 1] = acc[g + 1] / len;
      out[i * 3 + 2] = acc[g + 2] / len;
    }
  }
  return out;
}

/** Prosty budowniczy siatki: siatki parametryczne (kopuły, zasłony) i rury o zmiennym przekroju. */
export class MeshBuilder {
  private readonly pos: number[] = [];
  private readonly uv: number[] = [];
  private readonly idx: number[] = [];

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  get triangles(): number {
    return this.idx.length / 3;
  }

  vertex(p: Vec3, u = 0, v = 0): number {
    this.pos.push(p[0], p[1], p[2]);
    this.uv.push(u, v);
    return this.pos.length / 3 - 1;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  /**
   * Siatka `rows` x `cols` wierzchołków; `point(u, v)` dla u (wiersze) i v (kolumny) w 0..1.
   * `wrapCols`: ostatnia kolumna łączy się z pierwszą (kopuła dookoła głowy).
   */
  grid(rows: number, cols: number, point: (u: number, v: number) => Vec3, wrapCols = false): void {
    const base = this.vertexCount;
    const usedCols = wrapCols ? cols : cols;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < usedCols; c++) {
        const u = rows === 1 ? 0 : r / (rows - 1);
        const v = wrapCols ? c / cols : cols === 1 ? 0 : c / (cols - 1);
        this.vertex(point(u, v), v, u);
      }
    }
    const at = (r: number, c: number) => base + r * usedCols + (wrapCols ? c % cols : c);
    const lastC = wrapCols ? cols : cols - 1;
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < lastC; c++) {
        const a = at(r, c);
        const b = at(r, c + 1);
        const d = at(r + 1, c);
        const e = at(r + 1, c + 1);
        this.tri(a, d, b);
        this.tri(b, d, e);
      }
    }
  }

  /**
   * Rura wzdłuż łamanej `path` (>= 2 punkty) o przekroju eliptycznym: `radius(t)` zwraca półosie [szerokość, grubość]
   * (t w 0..1 wzdłuż ścieżki); szerokość leży w płaszczyźnie prostopadłej do `side`. Końce są zamknięte stożkiem.
   */
  tube(path: readonly Vec3[], radius: (t: number) => [number, number], sides = 6, side: Vec3 = [1, 0, 0]): void {
    if (path.length < 2) return;
    const n = path.length;
    const tangents: Vec3[] = path.map((p, i) => norm(sub(path[Math.min(n - 1, i + 1)], path[Math.max(0, i - 1)])));
    let right = norm(cross(tangents[0], side));
    if (len(right) < 1e-6) right = norm(cross(tangents[0], [0, 1, 0]));
    const ringStart = this.vertexCount;
    for (let i = 0; i < n; i++) {
      const t = tangents[i];
      // Transport równoległy ramki: prawy wektor przestaje być prostopadły do stycznej, więc go ortogonalizujemy.
      right = norm(sub(right, mul(t, dot(right, t))));
      const up = norm(cross(t, right));
      const [w, h] = radius(n === 1 ? 0 : i / (n - 1));
      for (let s = 0; s < sides; s++) {
        const a = (s / sides) * Math.PI * 2;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        this.vertex(
          [path[i][0] + right[0] * ca * w + up[0] * sa * h, path[i][1] + right[1] * ca * w + up[1] * sa * h, path[i][2] + right[2] * ca * w + up[2] * sa * h],
          s / sides,
          i / (n - 1),
        );
      }
    }
    for (let i = 0; i < n - 1; i++) {
      for (let s = 0; s < sides; s++) {
        const a = ringStart + i * sides + s;
        const b = ringStart + i * sides + ((s + 1) % sides);
        const c = a + sides;
        const d = b + sides;
        this.tri(a, c, b);
        this.tri(b, c, d);
      }
    }
    const tip = this.vertex([path[n - 1][0] + tangents[n - 1][0] * 0.002, path[n - 1][1] + tangents[n - 1][1] * 0.002, path[n - 1][2] + tangents[n - 1][2] * 0.002], 0.5, 1);
    const lastRing = ringStart + (n - 1) * sides;
    for (let s = 0; s < sides; s++) this.tri(lastRing + s, tip, lastRing + ((s + 1) % sides));
    const root = this.vertex([path[0][0] - tangents[0][0] * 0.002, path[0][1] - tangents[0][1] * 0.002, path[0][2] - tangents[0][2] * 0.002], 0.5, 0);
    for (let s = 0; s < sides; s++) this.tri(ringStart + ((s + 1) % sides), root, ringStart + s);
  }

  build(): MeshData {
    const positions = new Float32Array(this.pos);
    const indices = new Uint32Array(this.idx);
    return { positions, normals: smoothNormals(positions, indices), uvs: new Float32Array(this.uv), indices };
  }
}

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: Vec3): Vec3 => {
  const l = len(a);
  return l < 1e-12 ? [0, 1, 0] : [a[0] / l, a[1] / l, a[2] / l];
};
export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Deterministyczny generator pseudolosowy (mulberry32): te same fryzury w grze, panelu i testach. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
