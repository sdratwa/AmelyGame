/**
 * Moduły mostu z siatki GLB (czysty kod bez Three.js, testowalny w Node): cięcie trójkątów płaszczyznami z = const
 * oraz złożenie mostu z fragmentów (przyczółki, powtarzalne segmenty, segmenty z latarniami).
 *
 * Cięcie zachowuje UV i normalne (interpolowane na krawędziach cięcia), a trójkąty w całości wewnątrz zakresu dzielą
 * wierzchołki z oryginałem, więc moduły styka się dokładnie tak, jak w modelu. Fragmenty są spłaszczone względem
 * oryginalnego łuku (część środkowa) i składane wg `BridgeLayout`: skala jednostajna + niewielkie rozciągnięcie osi
 * (do 4%), końcówki zostają bez zmian.
 */
import {
  BRIDGE_MODEL,
  END_REACH,
  BRIDGE_SOURCE_RANGES,
  MODEL_FLAT_DECK,
  MODEL_TIP_DECK,
  modelDeckArch,
  type BridgeLayout,
  type BridgeSource,
} from "@/lib/game/world/bridgeLayout";

export type MeshData = {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array | Uint32Array;
};

type Vertex = { p: [number, number, number]; n: [number, number, number]; t: [number, number] };

function readVertex(mesh: MeshData, i: number): Vertex {
  return {
    p: [mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]],
    n: [mesh.normals[i * 3], mesh.normals[i * 3 + 1], mesh.normals[i * 3 + 2]],
    t: [mesh.uvs[i * 2], mesh.uvs[i * 2 + 1]],
  };
}

function lerpVertex(a: Vertex, b: Vertex, t: number): Vertex {
  const n: [number, number, number] = [a.n[0] + (b.n[0] - a.n[0]) * t, a.n[1] + (b.n[1] - a.n[1]) * t, a.n[2] + (b.n[2] - a.n[2]) * t];
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  return {
    p: [a.p[0] + (b.p[0] - a.p[0]) * t, a.p[1] + (b.p[1] - a.p[1]) * t, a.p[2] + (b.p[2] - a.p[2]) * t],
    n: [n[0] / len, n[1] / len, n[2] / len],
    t: [a.t[0] + (b.t[0] - a.t[0]) * t, a.t[1] + (b.t[1] - a.t[1]) * t],
  };
}

/** Odcina wielokąt płaszczyzną z (`keepAbove`: zostaje z >= plane, inaczej z <= plane); płaszczyzna należy do obu stron. */
function clipPolygon(poly: Vertex[], plane: number, keepAbove: boolean): Vertex[] {
  const out: Vertex[] = [];
  const inside = (v: Vertex) => (keepAbove ? v.p[2] >= plane : v.p[2] <= plane);
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i];
    const prev = poly[(i + poly.length - 1) % poly.length];
    const curIn = inside(cur);
    const prevIn = inside(prev);
    if (curIn !== prevIn) {
      const t = (plane - prev.p[2]) / (cur.p[2] - prev.p[2]);
      out.push(lerpVertex(prev, cur, t));
    }
    if (curIn) out.push(cur);
  }
  return out;
}

/**
 * Wycina z siatki trójkąty leżące w pasie `zMin <= z <= zMax` (przecięte są dzielone na płaszczyznach cięcia).
 * Trójkąt całkowicie w pasie zachowuje oryginalne wierzchołki; zdegenerowane skrawki (pole ~0) są pomijane.
 */
export function clipMeshZ(mesh: MeshData, zMin: number, zMax: number): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const remap = new Map<number, number>();
  const push = (v: Vertex) => {
    positions.push(v.p[0], v.p[1], v.p[2]);
    normals.push(v.n[0], v.n[1], v.n[2]);
    uvs.push(v.t[0], v.t[1]);
    return positions.length / 3 - 1;
  };
  const original = (i: number) => {
    let hit = remap.get(i);
    if (hit === undefined) {
      hit = push(readVertex(mesh, i));
      remap.set(i, hit);
    }
    return hit;
  };
  const triangles = mesh.indices.length / 3;
  for (let t = 0; t < triangles; t++) {
    const ia = mesh.indices[t * 3];
    const ib = mesh.indices[t * 3 + 1];
    const ic = mesh.indices[t * 3 + 2];
    const za = mesh.positions[ia * 3 + 2];
    const zb = mesh.positions[ib * 3 + 2];
    const zc = mesh.positions[ic * 3 + 2];
    const lo = Math.min(za, zb, zc);
    const hi = Math.max(za, zb, zc);
    if (hi < zMin || lo > zMax) continue;
    if (lo >= zMin && hi <= zMax) {
      indices.push(original(ia), original(ib), original(ic));
      continue;
    }
    let poly = [readVertex(mesh, ia), readVertex(mesh, ib), readVertex(mesh, ic)];
    poly = clipPolygon(poly, zMin, true);
    if (poly.length >= 3) poly = clipPolygon(poly, zMax, false);
    if (poly.length < 3) continue;
    const first = push(poly[0]);
    let prev = push(poly[1]);
    for (let k = 2; k < poly.length; k++) {
      const next = push(poly[k]);
      indices.push(first, prev, next);
      prev = next;
    }
  }
  const count = positions.length / 3;
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    uvs: Float32Array.from(uvs),
    indices: count > 65535 ? Uint32Array.from(indices) : Uint16Array.from(indices),
  };
}

export const triangleCountOf = (mesh: MeshData): number => mesh.indices.length / 3;

/** Wycina wszystkie rodzaje fragmentów mostu (7 przejść po siatce; wynik do ponownego użycia przy składaniu). */
export function sliceBridgeSources(source: MeshData): Record<BridgeSource, MeshData> {
  const out = {} as Record<BridgeSource, MeshData>;
  for (const key of Object.keys(BRIDGE_SOURCE_RANGES) as BridgeSource[]) {
    const [a, b] = BRIDGE_SOURCE_RANGES[key];
    out[key] = clipMeshZ(source, a, b);
  }
  return out;
}

/**
 * Składa most w układzie świata (wierzchołki od razu we współrzędnych świata, siatka leży w początku układu):
 *  - środek: wierzchołek spłaszczony względem oryginalnego łuku (y - łuk(z) + poziom płaski),
 *  - skala jednostajna `scale`, wzdłuż osi dodatkowo `axisScale` (<= 4%),
 *  - pokład na końcach stoi na terenie (`yWest`, `yEast`), między nimi leży wzdłuż prostej.
 * Normalne są obracane tylko wokół Y (przechył i skala osi są pomijalnie małe).
 */
export function assembleBridge(pieces: Record<BridgeSource, MeshData>, layout: BridgeLayout): MeshData {
  const tipZ = layout.halfMid + END_REACH;
  const perUnit = layout.scale * layout.axisScale;
  const slope = (layout.yEast - layout.yWest) / layout.length;
  let vertexTotal = 0;
  let indexTotal = 0;
  for (const slot of layout.slots) {
    vertexTotal += pieces[slot.source].positions.length / 3;
    indexTotal += pieces[slot.source].indices.length;
  }
  const positions = new Float32Array(vertexTotal * 3);
  const normals = new Float32Array(vertexTotal * 3);
  const uvs = new Float32Array(vertexTotal * 2);
  const indices = new Uint32Array(indexTotal);
  let v = 0;
  let ix = 0;
  for (const slot of layout.slots) {
    const piece = pieces[slot.source];
    const isEnd = slot.source === "end_west" || slot.source === "end_east";
    const dz = slot.dstStart - BRIDGE_SOURCE_RANGES[slot.source][0];
    const count = piece.positions.length / 3;
    for (let i = 0; i < count; i++) {
      const x = piece.positions[i * 3];
      const y = piece.positions[i * 3 + 1];
      const z = piece.positions[i * 3 + 2];
      const flatY = isEnd ? y : y - modelDeckArch(z) + MODEL_FLAT_DECK;
      const along = (z + dz + tipZ) * perUnit;
      const across = x * layout.scale;
      const o = (v + i) * 3;
      positions[o] = layout.west.x + layout.axis.x * along + layout.normal.x * across;
      positions[o + 1] = layout.yWest + slope * along + (flatY - MODEL_TIP_DECK) * layout.scale;
      positions[o + 2] = layout.west.z + layout.axis.z * along + layout.normal.z * across;
      const nx = piece.normals[i * 3];
      const ny = piece.normals[i * 3 + 1];
      const nz = piece.normals[i * 3 + 2];
      normals[o] = layout.axis.x * nz + layout.normal.x * nx;
      normals[o + 1] = ny;
      normals[o + 2] = layout.axis.z * nz + layout.normal.z * nx;
      uvs[(v + i) * 2] = piece.uvs[i * 2];
      uvs[(v + i) * 2 + 1] = piece.uvs[i * 2 + 1];
    }
    for (let k = 0; k < piece.indices.length; k++) indices[ix + k] = piece.indices[k] + v;
    v += count;
    ix += piece.indices.length;
  }
  return { positions, normals, uvs, indices };
}
