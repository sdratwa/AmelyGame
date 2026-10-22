import fs from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { describe, expect, it } from "vitest";
import { STABLE_NORMAL } from "./disposition";

/**
 * Dowód przyczyny migotania trawy na danych modeli: normalne wierzchołków wszystkich źdźbeł wskazują w górę, a kierunek
 * trójkątów (CCW) w znacznej części zaprzecza tym normalnym. Przy `DoubleSide` Three.js odwraca normalną na tylnej
 * ściance, więc strona widoczna dla kamery decyduje o oświetleniu (+Y albo -Y). Pozostałe modele ze współdzielonymi
 * materiałami (`leaves`, `flowers`) mają kierunek trójkątów zgodny z normalnymi, więc poprawka ich nie dotyczy.
 */
const dir = path.join(process.cwd(), "public/models");
const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")) as {
  models: { id: string; materials: string[]; lod: { file: string }[] }[];
  materials: { id: string; doubleSided: boolean; normal: string | null; alphaMode: string }[];
};
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

type Report = { triangles: number; windingDisagrees: number; minNy: number };

async function inspect(modelFile: string, materialId: string): Promise<Report> {
  const buf = fs.readFileSync(path.join(dir, modelFile));
  const gltf = await loader.parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, "");
  gltf.scene.updateMatrixWorld(true);
  const out: Report = { triangles: 0, windingDisagrees: 0, minNy: 1 };
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ng = new THREE.Vector3();
  const nv = new THREE.Vector3();
  const t = new THREE.Vector3();
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const source = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (source.name.toLowerCase() !== materialId) return;
    const pos = mesh.geometry.getAttribute("position");
    const nor = mesh.geometry.getAttribute("normal");
    const idx = mesh.geometry.getIndex();
    const tris = idx ? idx.count / 3 : pos.count / 3;
    const at = (i: number) => (idx ? idx.getX(i) : i);
    for (let i = 0; i < tris; i++) {
      const ids = [at(i * 3), at(i * 3 + 1), at(i * 3 + 2)];
      a.fromBufferAttribute(pos, ids[0]).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(pos, ids[1]).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(pos, ids[2]).applyMatrix4(mesh.matrixWorld);
      ng.subVectors(b, a).cross(t.subVectors(c, a));
      if (ng.length() < 1e-12) continue;
      nv.set(0, 0, 0);
      for (const k of ids) {
        nv.add(t.set(nor.getX(k), nor.getY(k), nor.getZ(k)));
        out.minNy = Math.min(out.minNy, nor.getY(k));
      }
      out.triangles++;
      if (ng.dot(nv) < 0) out.windingDisagrees++;
    }
  });
  return out;
}

describe("trawa: geometria i materiał (przyczyna migotania)", () => {
  const material = (id: string) => manifest.materials.find((m) => m.id === id)!;

  it("materiał trawy jest dwustronny, bez normal mapy i bez alfa, więc o jasności decyduje normalna z wierzchołków", () => {
    const grass = material("grass");
    expect(grass.doubleSided).toBe(true);
    expect(grass.normal).toBeNull();
    expect(grass.alphaMode).toBe("OPAQUE");
    expect([...STABLE_NORMAL]).toEqual(["grass"]);
  });

  it("cztery modele trawy: normalne wszystkich wierzchołków wskazują w górę, a kierunek trójkątów często się z nimi rozmija", async () => {
    // Poprawka dotyczy modeli Standard; modele trawy z paczki Pro (wheat, wide_*) mają własny, osobno oceniany kształt.
    const STANDARD = ["grass.common_short", "grass.common_tall", "grass.wispy_short", "grass.wispy_tall"];
    const models = manifest.models.filter((m) => m.materials.includes("grass") && STANDARD.includes(m.id));
    expect(models.map((m) => m.id).sort()).toEqual(STANDARD);
    for (const m of models) {
      const r = await inspect(m.lod[0].file, "grass");
      expect(r.triangles, m.id).toBeGreaterThan(100);
      expect(r.minNy, `${m.id}: normalne w górę`).toBeGreaterThan(0.9);
      expect(r.windingDisagrees, `${m.id}: trójkąty odwrócone względem normalnych`).toBeGreaterThan(20);
    }
  });

  it("modele z materiałami leaves i flowers mają kierunek trójkątów zgodny z normalnymi (poprawka ich nie dotyczy)", async () => {
    const shared = manifest.models.filter((m) => m.materials.some((x) => x === "leaves" || x === "flowers"));
    expect(shared.length).toBeGreaterThan(10);
    for (const m of shared) {
      for (const id of m.materials.filter((x) => x === "leaves" || x === "flowers")) {
        const r = await inspect(m.lod[0].file, id);
        expect(r.windingDisagrees, `${m.id}/${id}`).toBe(0);
      }
    }
  });
});
