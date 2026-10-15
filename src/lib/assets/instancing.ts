import * as THREE from "three";
import { type ModelAsset, pickLodIndex } from "./library";
import type { QualityProfile } from "./profiles";

/** Pozycja instancji w świecie. `scale` to jednolita skala albo skala osi (np. skały o zmiennych proporcjach). */
export type Placement = {
  x: number;
  y: number;
  z: number;
  yaw?: number;
  scale?: number | readonly [number, number, number];
  tiltX?: number;
  tiltZ?: number;
};

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _euler = new THREE.Euler(0, 0, 0, "YXZ");

export function composePlacementMatrix(target: THREE.Matrix4, p: Placement): THREE.Matrix4 {
  _pos.set(p.x, p.y, p.z);
  _euler.set(p.tiltX ?? 0, p.yaw ?? 0, p.tiltZ ?? 0);
  _quat.setFromEuler(_euler);
  const s = p.scale ?? 1;
  if (typeof s === "number") _scale.set(s, s, s);
  else _scale.set(s[0], s[1], s[2]);
  return target.compose(_pos, _quat, _scale);
}

export type InstancedModel = {
  group: THREE.Group;
  /** Liczba instancji na poziom LOD (indeksy jak w `asset.levels`). */
  counts: () => number[];
  /** Ponownie przydziela instancje do poziomów LOD wg odległości od kamery. Tanie, wołać co kilka klatek. */
  updateLods: (camera: THREE.Vector3) => void;
  /** Zwalnia tylko bufory instancji; geometrie i materiały należą do biblioteki. */
  dispose: () => void;
};

export type InstancingOptions = { profile: QualityProfile; castShadow?: boolean; receiveShadow?: boolean };

/**
 * Buduje `InstancedMesh` dla każdego (poziom LOD x część modelu). Wszystkie współdzielą geometrię i materiał z biblioteki,
 * więc koszt to liczba części (wywołań rysowania), nie liczba drzew.
 */
export function createInstancedModel(asset: ModelAsset, placements: readonly Placement[], options: InstancingOptions): InstancedModel {
  const { profile } = options;
  const castShadow = options.castShadow ?? profile.shadows;
  const receiveShadow = options.receiveShadow ?? profile.shadows;
  const group = new THREE.Group();
  group.name = `instances:${asset.id}`;

  const matrices = new Float32Array(placements.length * 16);
  const tmp = new THREE.Matrix4();
  placements.forEach((p, i) => composePlacementMatrix(tmp, p).toArray(matrices, i * 16));

  const meshes: THREE.InstancedMesh[][] = asset.levels.map((lod) =>
    lod.parts.map((part) => {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, placements.length);
      mesh.name = `${asset.id}:lod${lod.level}:${part.materialId}`;
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      mesh.count = 0;
      group.add(mesh);
      return mesh;
    }),
  );

  const counts = asset.levels.map(() => 0);
  const buckets = new Uint8Array(placements.length);
  const m = new THREE.Matrix4();

  const assign = (levelOf: (i: number) => number) => {
    counts.fill(0);
    for (let i = 0; i < placements.length; i++) {
      const level = levelOf(i);
      buckets[i] = level;
      counts[level]++;
    }
    const cursor = counts.map(() => 0);
    for (let i = 0; i < placements.length; i++) {
      const level = buckets[i];
      m.fromArray(matrices, i * 16);
      for (const mesh of meshes[level]) mesh.setMatrixAt(cursor[level], m);
      cursor[level]++;
    }
    meshes.forEach((parts, level) => {
      for (const mesh of parts) {
        mesh.count = counts[level];
        mesh.instanceMatrix.needsUpdate = true;
        // Sfera brzegowa musi obejmować aktualny zestaw instancji, inaczej frustum culling ucina całą grupę.
        if (counts[level] > 0) mesh.computeBoundingSphere();
        mesh.visible = counts[level] > 0;
      }
    });
  };

  assign(() => 0);

  const updateLods = (camera: THREE.Vector3) => {
    if (asset.levels.length < 2) return;
    assign((i) => {
      const dx = matrices[i * 16 + 12] - camera.x;
      const dy = matrices[i * 16 + 13] - camera.y;
      const dz = matrices[i * 16 + 14] - camera.z;
      return pickLodIndex(asset, Math.hypot(dx, dy, dz), profile);
    });
  };

  return {
    group,
    counts: () => [...counts],
    updateLods,
    dispose: () => {
      for (const parts of meshes) for (const mesh of parts) mesh.dispose();
    },
  };
}

/** Trójkąty i wywołania rysowania dla zestawu instancji (po przydziale LOD). */
export function instancedCost(asset: ModelAsset, counts: readonly number[]) {
  let triangles = 0;
  let drawCalls = 0;
  asset.levels.forEach((lod, i) => {
    if (counts[i] > 0) {
      triangles += (lod.triangles * counts[i]);
      drawCalls += lod.parts.length;
    }
  });
  return { triangles, drawCalls };
}
