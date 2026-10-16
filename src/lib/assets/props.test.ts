import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";
import { CHEST_PROP_ID, PropLoadError, loadChestAsset, type PropsManifest } from "./props";

const DIR = path.join(process.cwd(), "public/props");
const loader = new GLTFLoader();

const readJson = async (url: string) => JSON.parse(fs.readFileSync(path.join(DIR, url.replace(/^\/props\//, "")), "utf8"));
const readGlb = async (url: string) => {
  const buf = fs.readFileSync(path.join(DIR, url.replace(/^\/props\//, "")));
  return loader.parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, "");
};

describe("M1: model skrzyni baśniowej", () => {
  it("manifest zgadza się z plikiem i ze źródłem (rozmiar, trójkąty, suma SHA-256 oryginału)", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(DIR, "props.json"), "utf8")) as PropsManifest;
    const entry = manifest.props.find((p) => p.id === CHEST_PROP_ID)!;
    expect(fs.statSync(path.join(DIR, entry.file)).size).toBe(entry.bytes);
    expect(entry.source.sourceTriangles).toBe(entry.triangles);
    expect(entry.hingeNode).toBe("Lid_Hinge");
    const src = fs.readFileSync(path.join(process.cwd(), entry.source.file));
    expect(entry.source.sha256).toBe(createHash("sha256").update(src).digest("hex"));
  });

  it("struktura: korpus i pokrywa to osobne siatki, pivot zawiasu jest w węźle Lid_Hinge przy tylnej krawędzi", async () => {
    const asset = await loadChestAsset({ loadJson: readJson, loadGlb: readGlb });
    expect(asset.hinge.toArray()).toEqual([0, 0.505, -0.365]);
    asset.body.computeBoundingBox();
    asset.lid.computeBoundingBox();
    const body = asset.body.boundingBox!;
    const lid = asset.lid.boundingBox!.clone().translate(asset.hinge);
    // Zawias leży przy tylnej ściance korpusu, na wysokości górnej krawędzi, a pokrywa rozciąga się od niego ku przodowi (+Z).
    expect(Math.abs(asset.hinge.z - body.min.z)).toBeLessThan(0.1);
    expect(asset.hinge.y).toBeGreaterThan(body.max.y * 0.9);
    expect(lid.max.z).toBeGreaterThan(asset.hinge.z + 0.7);
    expect(lid.min.y).toBeGreaterThan(body.max.y * 0.85);
    // Pokrywa nie nachodzi na korpus od dołu: korpus kończy się tam, gdzie zaczyna się pokrywa (z tolerancją fazy).
    expect(body.max.y).toBeLessThan(lid.min.y + 0.1);
  });

  it("skala świata: szerokość ok. 1 m, geometria ma normalne i kolory, bez tekstur i alfy", async () => {
    const asset = await loadChestAsset({ loadJson: readJson, loadGlb: readGlb });
    expect(asset.size.width).toBeGreaterThan(0.95);
    expect(asset.size.width).toBeLessThan(1.1);
    expect(asset.size.height).toBeGreaterThan(0.7);
    expect(asset.size.height).toBeLessThan(0.85);
    for (const g of [asset.body, asset.lid]) {
      expect(g.getAttribute("normal")).toBeDefined();
      const color = g.getAttribute("color");
      expect(color.itemSize).toBe(3);
      expect(g.getAttribute("uv")).toBeUndefined();
    }
    expect(asset.material.vertexColors).toBe(true);
    expect(asset.material.map).toBeNull();
    expect(asset.triangles).toBe(7708);
  });

  it("otwarcie: obrót o kąt z manifestu wokół zawiasu unosi przód pokrywy i nie przenika korpusu", async () => {
    const asset = await loadChestAsset({ loadJson: readJson, loadGlb: readGlb });
    expect(asset.openAngle).toBeLessThan(-1.5);
    asset.body.computeBoundingBox();
    const bodyTopY = asset.body.boundingBox!.max.y;
    const rot = new THREE.Matrix4().makeRotationX(asset.openAngle);
    const pos = asset.lid.getAttribute("position");
    const v = new THREE.Vector3();
    let frontClosed = -Infinity;
    let frontOpen = -Infinity;
    let minOpenY = Infinity;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const closedY = v.y + asset.hinge.y;
      if (v.z > 0.6) frontClosed = Math.max(frontClosed, closedY);
      const w = v.clone().applyMatrix4(rot);
      if (v.z > 0.6) frontOpen = Math.max(frontOpen, w.y + asset.hinge.y);
      minOpenY = Math.min(minOpenY, w.y + asset.hinge.y);
    }
    expect(frontOpen).toBeGreaterThan(frontClosed + 0.3);
    expect(minOpenY).toBeGreaterThan(bodyTopY - 0.35);
    expect(minOpenY).toBeGreaterThan(0);
  });

  it("brak węzła zawiasu albo pliku to czytelny błąd, nie udawane otwieranie", async () => {
    await expect(loadChestAsset({ loadJson: async () => ({ schemaVersion: 1, props: [] }), loadGlb: readGlb })).rejects.toBeInstanceOf(PropLoadError);
    const manifest = await readJson("/props/props.json");
    manifest.props[0].hingeNode = "Nie_Ma_Takiego";
    await expect(loadChestAsset({ loadJson: async () => manifest, loadGlb: readGlb })).rejects.toThrow(/Nie_Ma_Takiego/);
    await expect(loadChestAsset({ loadJson: readJson, loadGlb: async () => Promise.reject(new Error("sieć")) })).rejects.toThrow(/chest\.fairy/);
  });
});
