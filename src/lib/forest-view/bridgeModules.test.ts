import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { forestBridgeOf } from "@/lib/game/world/lookup";
import { BRIDGE_SOURCE_RANGES, type BridgeSource } from "@/lib/game/world/bridgeLayout";
import { parseWithoutTextures, publicDir } from "@/lib/assets/glbTestkit";
import { assembleBridge, clipMeshZ, sliceBridgeSources, triangleCountOf, type MeshData } from "./bridgeModules";

/** Pas płaskich czworokątów w płaszczyźnie y = 0, x w [-1, 1], z w [z0, z1], `n` pasów wzdłuż z; UV = (x, z). */
function strip(z0: number, z1: number, n: number): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= n; i++) {
    const z = z0 + ((z1 - z0) * i) / n;
    for (const x of [-1, 1]) {
      positions.push(x, 0, z);
      normals.push(0, 1, 0);
      uvs.push(x, z);
    }
  }
  for (let i = 0; i < n; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  return { positions: Float32Array.from(positions), normals: Float32Array.from(normals), uvs: Float32Array.from(uvs), indices: Uint16Array.from(indices) };
}

function area(mesh: MeshData): number {
  let sum = 0;
  const p = mesh.positions;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const [a, b, c] = [mesh.indices[i] * 3, mesh.indices[i + 1] * 3, mesh.indices[i + 2] * 3];
    const ux = p[b] - p[a];
    const uy = p[b + 1] - p[a + 1];
    const uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a];
    const vy = p[c + 1] - p[a + 1];
    const vz = p[c + 2] - p[a + 2];
    sum += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  }
  return sum;
}

describe("clipMeshZ", () => {
  it("zachowuje pole powierzchni w zakresie i nie wychodzi poza płaszczyzny cięcia", () => {
    const mesh = strip(-1, 1, 7);
    const clipped = clipMeshZ(mesh, -0.3, 0.45);
    expect(area(clipped)).toBeCloseTo(2 * 0.75, 5);
    for (let i = 2; i < clipped.positions.length; i += 3) {
      expect(clipped.positions[i]).toBeGreaterThanOrEqual(-0.3 - 1e-6);
      expect(clipped.positions[i]).toBeLessThanOrEqual(0.45 + 1e-6);
    }
  });

  it("interpoluje UV i normalne na krawędzi cięcia", () => {
    const clipped = clipMeshZ(strip(-1, 1, 1), -0.25, 0.5);
    for (let v = 0; v < clipped.positions.length / 3; v++) {
      const z = clipped.positions[v * 3 + 2];
      const x = clipped.positions[v * 3];
      expect(clipped.uvs[v * 2]).toBeCloseTo(x, 5);
      expect(clipped.uvs[v * 2 + 1]).toBeCloseTo(z, 5);
      expect(clipped.normals[v * 3 + 1]).toBeCloseTo(1, 5);
    }
  });

  it("zakres poza siatką daje pusty wynik, a zakres obejmujący całość nie zmienia liczby trójkątów", () => {
    const mesh = strip(-1, 1, 4);
    expect(triangleCountOf(clipMeshZ(mesh, 2, 3))).toBe(0);
    expect(triangleCountOf(clipMeshZ(mesh, -5, 5))).toBe(triangleCountOf(mesh));
  });

  it("sąsiednie zakresy dają razem pole całej siatki (brak szczelin i nakładek)", () => {
    const mesh = strip(-1, 1, 5);
    const parts = [clipMeshZ(mesh, -1, -0.2), clipMeshZ(mesh, -0.2, 0.37), clipMeshZ(mesh, 0.37, 1)];
    expect(parts.reduce((s, m) => s + area(m), 0)).toBeCloseTo(area(mesh), 5);
  });
});

describe("assembleBridge", () => {
  /** Syntetyczne źródło: pasy po całej długości modelu (płaskie), wystarczą do sprawdzenia składania. */
  const synthetic = () => sliceBridgeSources(strip(-0.8443, 0.8443, 40));

  it("składa most w obrębie długości pokładu i szerokości modelu, bez NaN", () => {
    const l = forestBridgeOf(1);
    const mesh = assembleBridge(synthetic(), l);
    expect(triangleCountOf(mesh)).toBeGreaterThan(0);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const [x, y, z] = [mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]];
      expect(Number.isFinite(x + y + z)).toBe(true);
      const { along, across } = l.project(x, z);
      min = Math.min(min, along);
      max = Math.max(max, along);
      expect(Math.abs(across)).toBeLessThan(1.1 * l.scale + 0.01);
    }
    expect(min).toBeGreaterThan(-1.5);
    expect(max).toBeLessThan(l.length + 1.5);
  });

  it("pokład (czubki końcówek, z = ±deckTip) obejmuje dokładnie odległość między lądowiskami, dla wielu ziaren", () => {
    // Regresja: wcześniej liczba segmentów wynikała z długości 2*deckTip zamiast 2*END_REACH, więc pokład był o ok. 6 m za krótki.
    const deck = sliceBridgeSources(strip(-0.725, 0.725, 58));
    for (const seed of [1, 2, 7, 2030, 99991, 4000000000]) {
      const l = forestBridgeOf(seed);
      const mesh = assembleBridge(deck, l);
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < mesh.positions.length; i += 3) {
        const { along } = l.project(mesh.positions[i], mesh.positions[i + 2]);
        min = Math.min(min, along);
        max = Math.max(max, along);
      }
      expect(min, `seed=${seed}`).toBeCloseTo(0, 3);
      expect(max, `seed=${seed}`).toBeCloseTo(l.length, 3);
    }
  });

  it("każdy fragment źródłowy ma niepustą siatkę dla gęstej siatki wejściowej", () => {
    const pieces = synthetic();
    for (const key of Object.keys(BRIDGE_SOURCE_RANGES) as BridgeSource[]) expect(triangleCountOf(pieces[key]), key).toBeGreaterThan(0);
  });
});

describe("most z prawdziwego GLB (public/props/bridge.glb, tekstury pominięte)", () => {
  it("jest jedną siatką z normalnymi, UV i indeksami, a złożony most mieści się nad lądowiskami", async () => {
    const gltf = await parseWithoutTextures(publicDir("props", "bridge.glb"));
    gltf.scene.updateMatrixWorld(true);
    const meshes: THREE.Mesh[] = [];
    gltf.scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    expect(meshes).toHaveLength(1);
    const geo = meshes[0].geometry.clone().applyMatrix4(meshes[0].matrixWorld);
    const pos = geo.getAttribute("position");
    const nor = geo.getAttribute("normal");
    const uv = geo.getAttribute("uv");
    const idx = geo.getIndex();
    expect(nor && uv && idx).toBeTruthy();
    const comp = (attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, size: number) => {
      const out = new Float32Array(attr.count * size);
      for (let i = 0; i < attr.count; i++) {
        out[i * size] = attr.getX(i);
        out[i * size + 1] = attr.getY(i);
        if (size > 2) out[i * size + 2] = attr.getZ(i);
      }
      return out;
    };
    const source: MeshData = {
      positions: comp(pos, 3),
      normals: comp(nor, 3),
      uvs: comp(uv, 2),
      indices: Uint32Array.from(idx!.array as ArrayLike<number>),
    };
    expect(triangleCountOf(source)).toBe(49999);
    for (const seed of [1, 2030]) {
      const l = forestBridgeOf(seed);
      const mesh = assembleBridge(sliceBridgeSources(source), l);
      expect(triangleCountOf(mesh)).toBeGreaterThan(40000);
      let maxAlong = -Infinity;
      let minAlong = Infinity;
      for (let i = 0; i < mesh.positions.length; i += 3) {
        const { along, across } = l.project(mesh.positions[i], mesh.positions[i + 2]);
        minAlong = Math.min(minAlong, along);
        maxAlong = Math.max(maxAlong, along);
        expect(Math.abs(across)).toBeLessThan(3.2);
      }
      // Końce modelu (przyczółki) wystają poza lądowiska najwyżej o kilka dziesiątych metra.
      expect(minAlong).toBeGreaterThan(-1.2);
      expect(maxAlong).toBeLessThan(l.length + 1.2);
    }
  }, 60_000);
});
