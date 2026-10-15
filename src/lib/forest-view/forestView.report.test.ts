import fs from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { describe, it } from "vitest";
import { AssetLibrary } from "@/lib/assets";
import { DEFAULT_OVERRIDES, ForestInstancer, VIEW_PROFILES, buildForestWindow, buildGroundMesh } from ".";

const enabled = process.env.FOREST_REPORT === "1";
const MODELS_DIR = path.resolve(__dirname, "../../../public/models");
const raw = JSON.parse(fs.readFileSync(path.join(MODELS_DIR, "manifest.json"), "utf8"));
const gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

/** Raport V2a (liczby bez GPU): instancje i szacunek trójkątów modeli po przydziale LOD/odcięciu dla trzech profili. */
describe.skipIf(!enabled)("V2a: raport instancji i trójkątów", () => {
  it("drukuje liczby dla okna 3 x 3 i 7 x 7", async () => {
    for (const radius of [1, 3]) {
      const t0 = performance.now();
      const w = buildForestWindow({ radius });
      const tBuild = performance.now() - t0;
      const lines = [`== okno ${w.sectors.length} sektorów, seed ${w.seed}, sektor ${w.sector.id}, budowa ${tBuild.toFixed(0)} ms, instancje ${w.instanceCount} (ukryte odmiany: ${w.hiddenCount}) ==`];
      for (const id of ["LOW", "MEDIUM", "HIGH"] as const) {
        const lib = new AssetLibrary({
          profile: VIEW_PROFILES[id].assets,
          baseUrl: "/models",
          loadManifestJson: async () => raw,
          loadGlb: async (url) => {
            const buf = fs.readFileSync(path.join(MODELS_DIR, url.replace(/^\/models\//, "")));
            return gltf.parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, "");
          },
          loadTexture: async () => new THREE.Texture(),
        });
        const inst = new ForestInstancer(lib, w, VIEW_PROFILES[id], { ...DEFAULT_OVERRIDES, distanceScale: radius > 1 ? 2 : 1 });
        await inst.init();
        const cam = new THREE.PerspectiveCamera(72, 16 / 9, 0.1, 620);
        cam.rotation.order = "YXZ";
        const results = [0, 1.57, 3.14, 4.71].map((yaw) => {
          cam.position.set(w.start.x, 1.7, w.start.z);
          cam.rotation.y = yaw;
          cam.updateMatrixWorld(true);
          return inst.update(cam);
        });
        const ground = buildGroundMesh(w.forest.terrain, w.windowBounds, radius > 1 ? Math.max(VIEW_PROFILES[id].groundCell, 1.4) : VIEW_PROFILES[id].groundCell).triangleCount;
        const tri = results.map((r) => r.triangles);
        lines.push(
          `${id}: widoczne instancje ${Math.min(...results.map((r) => r.visible))}-${Math.max(...results.map((r) => r.visible))}, modele ${Math.max(...results.map((r) => r.activeModels))}, ` +
            `trójkąty modeli (4 kierunki) ${Math.min(...tri)}-${Math.max(...tri)}, grunt ${ground}, draw calls modeli ${Math.max(...results.map((r) => r.drawCalls))}`,
        );
        inst.dispose();
        await lib.dispose();
      }
      console.info(lines.join("\n"));
    }
  }, 120_000);
});
