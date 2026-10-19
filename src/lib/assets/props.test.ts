import { createHash } from "node:crypto";
import fs from "node:fs";
import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { parseWithoutTextures, publicDir, readGlbDocument, readJsonFile } from "./glbTestkit";
import { CHEST_PROP_ID, PropLoadError, loadChestAsset, type ChestAsset, type PropsManifest } from "./props";

const readJson = async (url: string) => readJsonFile(publicDir(url.replace(/^\//, "")));
const readGlb = async (url: string) => parseWithoutTextures(publicDir(url.replace(/^\//, "")));
const manifest = () => readJsonFile(publicDir("props/props.json")) as PropsManifest;

let asset: ChestAsset;
beforeAll(async () => {
  asset = await loadChestAsset({ loadJson: readJson, loadGlb: readGlb });
});

describe("skrzynia ze skarbem: pliki i manifest", () => {
  it("źródło ma trzy siatki tripo_part_0..2, ok. 9257 trójkątów, wymiary ok. 1 x 0,68 x 0,75 i brak szkieletu oraz animacji", async () => {
    const entry = manifest().props.find((p) => p.id === CHEST_PROP_ID)!;
    const doc = await readGlbDocument(entry.source.file);
    const root = doc.getRoot();
    const names = root
      .listNodes()
      .filter((n) => n.getMesh())
      .map((n) => n.getName())
      .sort();
    expect(names).toEqual(["tripo_part_0", "tripo_part_1", "tripo_part_2"]);
    expect(root.listAnimations()).toHaveLength(0);
    expect(root.listSkins()).toHaveLength(0);
    expect(root.listNodes().some((n) => n.getName() === "Lid_Hinge")).toBe(false);
    expect(entry.source.sourceTriangles).toBe(9257);
    expect(entry.sourceBounds.max[0] - entry.sourceBounds.min[0]).toBeCloseTo(1, 1);
    expect(entry.sourceBounds.max[1]).toBeCloseTo(0.68, 2);
    expect(entry.sourceBounds.max[2] - entry.sourceBounds.min[2]).toBeCloseTo(0.75, 1);
    expect(root.listTextures().map((t) => t.getSize())).toContainEqual([4096, 4096]);
  });

  it("manifest zgadza się z plikiem i z oryginałem (rozmiar, trójkąty, SHA-256), oryginał zostaje w assets/source", () => {
    const entry = manifest().props.find((p) => p.id === CHEST_PROP_ID)!;
    expect(fs.statSync(publicDir("props", entry.file)).size).toBe(entry.bytes);
    expect(entry.triangles).toBe(entry.source.sourceTriangles);
    expect(entry.hingeNode).toBe("Lid_Hinge");
    expect(entry.source.sha256).toBe(createHash("sha256").update(fs.readFileSync(entry.source.file)).digest("hex"));
    expect(manifest().props.some((p) => p.id === "chest.fairy")).toBe(false);
  });

  it("wariant gry: trzy materiały z teksturami WebP, największa tekstura 2048, geometria bez zmian poza przesunięciem pokrywy", async () => {
    const entry = manifest().props.find((p) => p.id === CHEST_PROP_ID)!;
    const game = await readGlbDocument(publicDir("props", entry.file));
    const textures = game.getRoot().listTextures();
    expect(textures).toHaveLength(3);
    for (const t of textures) {
      expect(t.getMimeType()).toBe("image/webp");
      expect(Math.max(...t.getSize()!)).toBeLessThanOrEqual(2048);
    }
    expect(game.getRoot().listMaterials()).toHaveLength(3);
    for (const m of game.getRoot().listMaterials()) expect(m.getBaseColorTexture()).not.toBeNull();
    const src = await readGlbDocument(entry.source.file);
    const count = (d: typeof game) => d.getRoot().listMeshes().flatMap((m) => m.listPrimitives()).map((p) => p.getAttribute("POSITION")!.getCount()).sort((a, b) => a - b);
    expect(count(game)).toEqual(count(src));
    expect(fs.statSync(publicDir("props", entry.file)).size).toBeLessThan(fs.statSync(entry.source.file).size / 3);
  });
});

describe("skrzynia ze skarbem: węzły i zawias", () => {
  it("węzły: korpus i zamek poza zawiasem, pokrywa jest dzieckiem Lid_Hinge, pivot z manifestu", async () => {
    const gltf = await readGlb("/props/chest.treasure.glb");
    const names = ["Chest_Body", "Chest_Lock", "Lid_Hinge", "Chest_Lid"].map((n) => gltf.scene.getObjectByName(n));
    names.forEach((n) => expect(n).toBeDefined());
    const hinge = gltf.scene.getObjectByName("Lid_Hinge")!;
    expect(hinge.getObjectByName("Chest_Lid")).toBeDefined();
    expect(hinge.getObjectByName("Chest_Body")).toBeUndefined();
    expect(hinge.getObjectByName("Chest_Lock")).toBeUndefined();
    expect(asset.hinge.toArray()).toEqual([asset.entry.hinge.x, asset.entry.hinge.y, asset.entry.hinge.z]);
  });

  it("pivot leży przy tylnej krawędzi pokrywy (ok. -0,354 w Z, dolna linia pokrywy), a pokrywa rozciąga się od niego ku przodowi (+Z)", () => {
    asset.lid.computeBoundingBox();
    asset.body.computeBoundingBox();
    const lid = asset.lid.boundingBox!.clone().translate(asset.hinge);
    expect(asset.hinge.x).toBeCloseTo(0, 2);
    expect(asset.hinge.z).toBeCloseTo(lid.min.z, 2);
    expect(asset.hinge.y).toBeCloseTo(lid.min.y, 1);
    expect(asset.hinge.y).toBeGreaterThan(asset.body.boundingBox!.max.y * 0.85);
    expect(lid.max.z - asset.hinge.z).toBeGreaterThan(0.65);
    expect(lid.max.z - lid.min.z).toBeGreaterThan(0.65);
  });

  it("zamek jest z przodu (+Z) i nie przesuwa się razem z pokrywą (osobna siatka poza zawiasem)", () => {
    asset.lock.computeBoundingBox();
    const lock = asset.lock.boundingBox!;
    expect(lock.min.z).toBeGreaterThan(0.25);
    expect(lock.max.z).toBeGreaterThan(0.35);
    expect(Math.abs(lock.getCenter(new THREE.Vector3()).x)).toBeLessThan(0.15);
  });

  it("skala i trójkąty: szerokość ok. 1 m, wysokość ok. 0,68 m, 9257 trójkątów", () => {
    expect(asset.size.width).toBeGreaterThan(0.95);
    expect(asset.size.width).toBeLessThan(1.05);
    expect(asset.size.height).toBeGreaterThan(0.65);
    expect(asset.size.height).toBeLessThan(0.72);
    expect(asset.size.depth).toBeGreaterThan(0.7);
    expect(asset.size.depth).toBeLessThan(0.8);
    expect(asset.triangles).toBe(9257);
    for (const g of [asset.body, asset.lock, asset.lid]) {
      expect(g.getAttribute("normal")).toBeDefined();
      expect(g.getAttribute("uv")).toBeDefined();
    }
  });

  const rotateLid = (deg: number) => {
    const rot = new THREE.Matrix4().makeRotationX((deg * Math.PI) / 180);
    const pos = asset.lid.getAttribute("position");
    const out: THREE.Vector3[] = [];
    for (let i = 0; i < pos.count; i++) out.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(rot).add(asset.hinge));
    return out;
  };

  it("oś i kierunek otwierania: kąt z manifestu jest ujemny wokół X, przód pokrywy idzie w górę, krawędź zawiasu zostaje na miejscu", () => {
    expect(asset.entry.openAxis).toBe("x");
    expect(asset.openAngle).toBeLessThan(-1.5);
    const closed = rotateLid(0);
    const open = rotateLid(asset.entry.openAngleDeg);
    let frontClosedY = -Infinity;
    let frontOpenY = -Infinity;
    let rearMoved = 0;
    for (let i = 0; i < closed.length; i++) {
      const rel = closed[i].z - asset.hinge.z;
      if (rel > 0.6) {
        frontClosedY = Math.max(frontClosedY, closed[i].y);
        frontOpenY = Math.max(frontOpenY, open[i].y);
      }
      // Wierzchołki leżące na osi zawiasu (rel ~ 0, wysokość ~ hinge.y) nie mogą się ruszyć.
      if (Math.hypot(rel, closed[i].y - asset.hinge.y) < 0.01) rearMoved = Math.max(rearMoved, closed[i].distanceTo(open[i]));
    }
    expect(frontOpenY).toBeGreaterThan(frontClosedY + 0.3);
    expect(rearMoved).toBeLessThan(0.02);
    // Przeciwny kierunek (dodatni kąt) wbiłby przód pokrywy w korpus: sprawdzamy, że nasz wybór jest właściwy.
    const wrong = rotateLid(-asset.entry.openAngleDeg);
    const wrongFront = Math.min(...wrong.filter((_, i) => closed[i].z - asset.hinge.z > 0.6).map((v) => v.y));
    expect(wrongFront).toBeLessThan(asset.hinge.y - 0.3);
  });

  it("pokrywa nie odrywa się od korpusu: nad osią zawiasu jej tylna krawędź zostaje przy tylnej ściance w całym zakresie kątów", () => {
    asset.body.computeBoundingBox();
    const bodyBox = asset.body.boundingBox!;
    for (let deg = 0; deg <= 105; deg += 5) {
      const pts = rotateLid(-deg);
      let nearest = Infinity;
      for (const p of pts) nearest = Math.min(nearest, Math.hypot(p.z - asset.hinge.z, p.y - asset.hinge.y));
      expect(nearest).toBeLessThan(0.02);
      // Dolna krawędź pokrywy nie schodzi głębiej w korpus niż w pozycji zamkniętej (obwiednia jest zachowawcza).
      let depth = 0;
      for (const p of pts) {
        if (p.x > bodyBox.min.x && p.x < bodyBox.max.x && p.z > bodyBox.min.z && p.z < bodyBox.max.z && p.y < bodyBox.max.y) depth = Math.max(depth, bodyBox.max.y - p.y);
      }
      expect(depth).toBeLessThan(0.05);
    }
  });

  it("brak węzła zawiasu albo pliku to czytelny błąd, nie udawane otwieranie", async () => {
    await expect(loadChestAsset({ loadJson: async () => ({ schemaVersion: 1, props: [] }), loadGlb: readGlb })).rejects.toBeInstanceOf(PropLoadError);
    const broken = (await readJson("/props/props.json")) as PropsManifest;
    broken.props[0].hingeNode = "Nie_Ma_Takiego";
    await expect(loadChestAsset({ loadJson: async () => broken, loadGlb: readGlb })).rejects.toThrow(/Nie_Ma_Takiego/);
    await expect(loadChestAsset({ loadJson: readJson, loadGlb: async () => Promise.reject(new Error("sieć")) })).rejects.toThrow(/chest\.treasure/);
  });
});
