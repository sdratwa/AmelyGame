import { regionOfBone, type BodyRegion } from "../bodyRegions";
import { smoothNormals, smoothstep, type MeshData } from "../meshData";

/** Bazowa siatka w tablicach płaskich (z `BufferGeometry` bazowej postaci albo z testu). */
export type BodyMeshInput = {
  positions: ArrayLike<number>;
  uvs: ArrayLike<number>;
  skinIndex: ArrayLike<number>;
  skinWeight: ArrayLike<number>;
  indices: ArrayLike<number>;
  /** Region ciała dla każdej kości (indeks = indeks kości w szkielecie). */
  jointRegions: readonly BodyRegion[];
};

/** Region ciała dla każdej kości szkieletu (po nazwach kości). */
export const jointRegionsOf = (boneNames: readonly string[]): BodyRegion[] => boneNames.map(regionOfBone);

/** Dominujący region ciała każdego wierzchołka (suma wag kości po regionach). */
export function vertexRegions(body: Pick<BodyMeshInput, "positions" | "skinIndex" | "skinWeight" | "jointRegions">): BodyRegion[] {
  const n = body.positions.length / 3;
  const out = new Array<BodyRegion>(n);
  const acc = new Map<BodyRegion, number>();
  for (let i = 0; i < n; i++) {
    acc.clear();
    for (let k = 0; k < 4; k++) {
      const w = body.skinWeight[i * 4 + k];
      if (w <= 0) continue;
      const r = body.jointRegions[body.skinIndex[i * 4 + k]] ?? "other";
      acc.set(r, (acc.get(r) ?? 0) + w);
    }
    let best: BodyRegion = "other";
    let bw = -1;
    for (const [r, w] of acc) {
      if (w > bw) {
        bw = w;
        best = r;
      }
    }
    out[i] = best;
  }
  return out;
}

/** Opis ubrania wyprowadzonego z bazowej siatki (powłoka dopasowana do ciała, w tym samym szkielecie). */
export type ShellSpec = {
  /** Regiony, z których powstaje powłoka (trójkąt wchodzi, gdy wszystkie trzy wierzchołki są w tych regionach). */
  regions: readonly BodyRegion[];
  /** Płaszczyzny cięcia (jednostki modelu): linia dołu, kołnierz, długość rękawa. */
  yMin?: number;
  yMax?: number;
  absXMax?: number;
  /** Odsunięcie powłoki od skóry wzdłuż wygładzonej normalnej. */
  offset: number;
  /** Dodatkowe poszerzenie przy dole (ubranie "odstaje" od nóg): od `fromY` do `toY` narasta do `extra`. */
  flare?: { fromY: number; toY: number; extra: number };
};

type V = { p: [number, number, number]; n: [number, number, number]; uv: [number, number]; ji: [number, number, number, number]; jw: [number, number, number, number] };

function lerpV(a: V, b: V, t: number): V {
  const src = t < 0.5 ? a : b;
  return {
    p: [a.p[0] + (b.p[0] - a.p[0]) * t, a.p[1] + (b.p[1] - a.p[1]) * t, a.p[2] + (b.p[2] - a.p[2]) * t],
    n: [a.n[0] + (b.n[0] - a.n[0]) * t, a.n[1] + (b.n[1] - a.n[1]) * t, a.n[2] + (b.n[2] - a.n[2]) * t],
    uv: [a.uv[0] + (b.uv[0] - a.uv[0]) * t, a.uv[1] + (b.uv[1] - a.uv[1]) * t],
    // Kości i wagi bierzemy w całości z bliższego końca krawędzi (mieszanie indeksów kości nie ma sensu).
    ji: [...src.ji],
    jw: [...src.jw],
  };
}

/** Sutherland-Hodgman dla jednej płaszczyzny: zostawia wierzchołki, dla których `value(v) >= 0`. */
function clip(poly: V[], value: (v: V) => number): V[] {
  const out: V[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const da = value(a);
    const db = value(b);
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) out.push(lerpV(a, b, da / (da - db)));
  }
  return out;
}

/**
 * Wyprowadza ubranie z bazowej siatki: wybiera trójkąty regionów, przycina je płaszczyznami (proste, równe krawędzie dołu,
 * kołnierza i rękawów), odsuwa po wygładzonych normalnych (bez pęknięć na szwach UV) i zachowuje te same indeksy kości i wagi,
 * więc ubranie deformuje się dokładnie jak ciało i wymaga tylko tego samego szkieletu. Funkcja czysta i deterministyczna.
 */
export function deriveShell(body: BodyMeshInput, spec: ShellSpec): MeshData {
  const n = body.positions.length / 3;
  const normals = smoothNormals(body.positions, body.indices);
  const region = vertexRegions(body);

  const vertexAt = (i: number): V => ({
    p: [body.positions[i * 3], body.positions[i * 3 + 1], body.positions[i * 3 + 2]],
    n: [normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]],
    uv: [body.uvs[i * 2], body.uvs[i * 2 + 1]],
    ji: [body.skinIndex[i * 4], body.skinIndex[i * 4 + 1], body.skinIndex[i * 4 + 2], body.skinIndex[i * 4 + 3]],
    jw: [body.skinWeight[i * 4], body.skinWeight[i * 4 + 1], body.skinWeight[i * 4 + 2], body.skinWeight[i * 4 + 3]],
  });

  const verts: V[] = [];
  const tris: number[] = [];
  // Wierzchołki nieprzycięte są współdzielone między trójkątami (po jednym na indeks bazowy); nowe powstają tylko na cięciach.
  const originals = new Map<number, V>();
  const originalOf = new Map<V, number>();
  const newIndex = new Map<number, number>();
  const original = (i: number): V => {
    let v = originals.get(i);
    if (!v) {
      v = vertexAt(i);
      originals.set(i, v);
      originalOf.set(v, i);
    }
    return v;
  };
  const emit = (v: V): number => {
    const src = originalOf.get(v);
    if (src !== undefined) {
      const known = newIndex.get(src);
      if (known !== undefined) return known;
      verts.push(v);
      newIndex.set(src, verts.length - 1);
      return verts.length - 1;
    }
    verts.push(v);
    return verts.length - 1;
  };
  for (let t = 0; t < body.indices.length; t += 3) {
    const ia = body.indices[t];
    const ib = body.indices[t + 1];
    const ic = body.indices[t + 2];
    if (!spec.regions.includes(region[ia]) || !spec.regions.includes(region[ib]) || !spec.regions.includes(region[ic])) continue;
    let poly: V[] = [original(ia), original(ib), original(ic)];
    if (spec.yMin !== undefined) poly = clip(poly, (v) => v.p[1] - spec.yMin!);
    if (poly.length >= 3 && spec.yMax !== undefined) poly = clip(poly, (v) => spec.yMax! - v.p[1]);
    if (poly.length >= 3 && spec.absXMax !== undefined) {
      poly = clip(poly, (v) => spec.absXMax! - v.p[0]);
      if (poly.length >= 3) poly = clip(poly, (v) => v.p[0] + spec.absXMax!);
    }
    if (poly.length < 3) continue;
    const ids = poly.map(emit);
    for (let k = 1; k + 1 < ids.length; k++) tris.push(ids[0], ids[k], ids[k + 1]);
  }

  const positions = new Float32Array(verts.length * 3);
  const uvs = new Float32Array(verts.length * 2);
  const skinIndex = new Uint16Array(verts.length * 4);
  const skinWeight = new Float32Array(verts.length * 4);
  verts.forEach((v, i) => {
    const nl = Math.hypot(v.n[0], v.n[1], v.n[2]) || 1;
    let off = spec.offset;
    if (spec.flare) off += spec.flare.extra * smoothstep(spec.flare.fromY, spec.flare.toY, v.p[1]);
    positions[i * 3] = v.p[0] + (v.n[0] / nl) * off;
    positions[i * 3 + 1] = v.p[1] + (v.n[1] / nl) * off;
    positions[i * 3 + 2] = v.p[2] + (v.n[2] / nl) * off;
    uvs[i * 2] = v.uv[0];
    uvs[i * 2 + 1] = v.uv[1];
    for (let k = 0; k < 4; k++) {
      skinIndex[i * 4 + k] = v.ji[k];
      skinWeight[i * 4 + k] = v.jw[k];
    }
  });
  const indices = new Uint32Array(tris);
  return { positions, normals: smoothNormals(positions, indices), uvs, indices, skinIndex, skinWeight };
}
