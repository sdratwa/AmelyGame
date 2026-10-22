import fs from "node:fs";
import crypto from "node:crypto";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { parseWithoutTextures, publicDir, readGlbDocument } from "@/lib/assets/glbTestkit";
import type { GlbResult } from "@/lib/assets/library";
import { sceneNodeName } from "@/lib/assets/characters";
import { DEFAULT_APPEARANCE, findItem, glbFileForLod, withAppearance } from "@/lib/character";
import { loadTestPlayer } from "@/lib/tpp/testkit";
import { AppearanceRig } from "./appearanceRig";
import { GlbHairCache } from "./hairGlb";

const HAIR_ID = "hair_tripo_short_01";
const item = () => findItem(HAIR_ID, "hair")!;
const file = () => glbFileForLod(item(), 0)!;
const hairPath = () => publicDir("characters", file());
const tripo = (patch: Parameters<typeof withAppearance>[1] = {}) => withAppearance(DEFAULT_APPEARANCE, { hairStyleId: HAIR_ID, ...patch });

/** Loader testowy: prawdziwy plik GLB z repozytorium, bez dekodowania tekstur (Node nie ma DOM); liczy wywołania. */
function makeLoader() {
  const calls: string[] = [];
  const load = (url: string) => {
    calls.push(url);
    return parseWithoutTextures(publicDir(url.replace(/^\/characters\//, "characters/")));
  };
  return { calls, load };
}

const expectArray = (actual: ArrayLike<number>, expected: number[], digits = 6) => {
  expected.forEach((v, i) => expect(actual[i]).toBeCloseTo(v, digits));
};

/** Rig z cache'em testowym i obietnicą kolejnej asynchronicznej zmiany (wczytanie albo błąd). */
async function setup(load: (url: string) => Promise<GlbResult>) {
  const a = await loadTestPlayer();
  const cache = new GlbHairCache(load, { retainMs: 0 });
  let wake: (() => void) | null = null;
  const rig = new AppearanceRig(a, { cache, onUpdate: () => wake?.() });
  const nextUpdate = () => new Promise<void>((resolve) => (wake = resolve));
  const head = a.scene.getObjectByName(sceneNodeName("mixamorig:Head"))!;
  const find = (name: string) => {
    let found: THREE.Object3D | undefined;
    a.scene.traverse((o) => {
      if (o.name === name) found = o;
    });
    return found;
  };
  return { a, cache, rig, nextUpdate, head, find };
}

describe("plik fryzury Tripo3D w repozytorium", () => {
  it("leży w public/characters/hair, bajty są niezmienione (geometria i tekstury bez przeróbek)", () => {
    expect(file()).toBe("hair/Miasto_Fryzura_HeadLocal_Wstepne_Dopasowanie.glb");
    const bytes = fs.readFileSync(hairPath());
    expect(bytes.length).toBe(6322500);
    expect(crypto.createHash("sha256").update(bytes).digest("hex")).toBe("e9e47f38ca7359ced47c176e9c73b49b1c7baf1fe1aac6a19055be0a4e40ad5b");
  });

  it("jedna siatka bez szkieletu, ~22,5 tys. trójkątów w budżecie rejestru, materiał PBR z teksturami", async () => {
    const doc = await readGlbDocument(hairPath());
    const root = doc.getRoot();
    expect(root.listMeshes()).toHaveLength(1);
    expect(root.listSkins()).toHaveLength(0);
    expect(root.listAnimations()).toHaveLength(0);
    expect(root.listMaterials()).toHaveLength(1);
    expect(root.listTextures().length).toBeGreaterThanOrEqual(2);
    const prim = root.listMeshes()[0].listPrimitives()[0];
    const triangles = prim.getIndices()!.getCount() / 3;
    expect(triangles).toBe(22537);
    expect(triangles).toBeLessThanOrEqual(item().triangleBudget);
  });
});

describe("GlbHairCache", () => {
  it("jedno pobranie i parsowanie dla wielu użytkowników; zasoby zwolnione dopiero po ostatnim release", async () => {
    const { calls, load } = makeLoader();
    const cache = new GlbHairCache(load, { retainMs: 0 });
    const url = `/characters/${file()}`;
    const [x, y] = await Promise.all([cache.acquire(url), cache.acquire(url)]);
    expect(x).toBe(y);
    expect(calls).toHaveLength(1);
    expect(cache.stats().refs[url]).toBe(2);
    let disposed = 0;
    x.geometry.addEventListener("dispose", () => disposed++);
    cache.release(url);
    expect(disposed).toBe(0);
    cache.release(url);
    await Promise.resolve();
    await Promise.resolve();
    expect(disposed).toBe(1);
    expect(cache.stats().entries).toBe(0);
    await cache.acquire(url);
    expect(calls).toHaveLength(2);
    cache.release(url);
  });

  it("błąd wczytania nie zostaje w cache", async () => {
    let fail = true;
    const { load } = makeLoader();
    const cache = new GlbHairCache((url) => (fail ? Promise.reject(new Error("HTTP 404")) : load(url)), { retainMs: 0 });
    const url = `/characters/${file()}`;
    await expect(cache.acquire(url)).rejects.toThrow("HTTP 404");
    expect(cache.stats().entries).toBe(0);
    fail = false;
    await expect(cache.acquire(url)).resolves.toBeTruthy();
    cache.release(url);
  });
});

describe("AppearanceRig: fryzura GLB", () => {
  it("do czasu wczytania zostaje poprzednia fryzura, potem GLB zastępuje ją na kości głowy z bazą z pliku", async () => {
    const { calls, load } = makeLoader();
    const { a, rig, nextUpdate, head, find, cache } = await setup(load);
    rig.apply(DEFAULT_APPEARANCE);
    expect(rig.stats().hair).toBe("hair.01");
    const done = nextUpdate();
    rig.apply(tripo());
    expect(rig.stats().hair).toBe("hair.01");
    expect(rig.stats().loading).toEqual([HAIR_ID]);
    await done;
    const s = rig.stats();
    expect(s.hair).toBe(HAIR_ID);
    expect(s.loading).toEqual([]);
    expect(s.missing).toEqual([]);
    expect(s.triangles.hair).toBe(22537);
    expect(s.triangles.hair).toBeLessThanOrEqual(item().triangleBudget);
    expect(calls).toEqual([`/characters/${file()}`]);
    expect(find("appearance-hair.01")).toBeUndefined();

    const pivot = find(`appearance-${HAIR_ID}-pivot`)!;
    const mesh = find(`appearance-${HAIR_ID}`) as THREE.Mesh;
    expect(pivot.parent).toBe(head);
    // Bez dopasowania: dokładnie transformacja z pliku (tożsamość), żadnej automatycznej skali.
    expectArray(pivot.position.toArray(), [0, 0, 0]);
    expectArray(pivot.scale.toArray(), [1, 1, 1]);
    expectArray(pivot.quaternion.toArray(), [0, 0, 0, 1]);
    expectArray(mesh.matrix.elements, new THREE.Matrix4().elements);
    // W pozie wiązania czubek fryzury leży ok. 0,241 nad kością głowy.
    a.scene.updateMatrixWorld(true);
    const headY = new THREE.Vector3().setFromMatrixPosition(head.matrixWorld).y;
    const box = new THREE.Box3().setFromObject(mesh);
    expect(box.max.y - headY).toBeCloseTo(0.241, 2);
    expect(box.min.y - headY).toBeCloseTo(-0.029, 2);

    // Sztywno za głową: po obrocie kości macierz świata siatki = macierz świata kości.
    head.rotation.x += 0.5;
    head.position.y += 0.02;
    a.scene.updateMatrixWorld(true);
    expectArray(mesh.matrixWorld.elements, head.matrixWorld.elements);
    expect(cache.stats().refs[`/characters/${file()}`]).toBe(1);
    rig.dispose();
    expect(cache.stats().entries).toBe(0);
  });

  it("dopasowanie jest korektą dodawaną do bazy, dotyczy tylko tej fryzury i przeżywa wymianę", async () => {
    const { load } = makeLoader();
    const { rig, nextUpdate, find } = await setup(load);
    const initialFit = rig.getFit("hair.01");
    rig.setFit(HAIR_ID, { position: [0.01, 0.02, -0.01], rotationDeg: [3, 4, 5], scale: [1.1, 1.2, 1.3] });
    expect(rig.getFit("hair.01")).toEqual(initialFit);
    const done = nextUpdate();
    rig.apply(tripo());
    await done;
    const pivot = find(`appearance-${HAIR_ID}-pivot`)!;
    expectArray(pivot.position.toArray(), [0.01, 0.02, -0.01]);
    expectArray(pivot.scale.toArray(), [1.1, 1.2, 1.3]);
    expect(pivot.rotation.x).toBeCloseTo((3 * Math.PI) / 180, 6);
    rig.resetFit(HAIR_ID);
    expectArray(pivot.position.toArray(), [0, 0, 0]);
    expectArray(pivot.scale.toArray(), [1, 1, 1]);
    rig.dispose();
  });

  it("fryzury proceduralne działają bez zmian; powrót do nich zwalnia GLB", async () => {
    const { load } = makeLoader();
    const { rig, nextUpdate, find, cache } = await setup(load);
    rig.apply(DEFAULT_APPEARANCE);
    const hair01 = find("appearance-hair.01");
    const done = nextUpdate();
    rig.apply(tripo());
    await done;
    rig.apply(withAppearance(tripo(), { hairStyleId: "hair.02" }));
    expect(rig.stats().hair).toBe("hair.02");
    expect(find(`appearance-${HAIR_ID}-pivot`)).toBeUndefined();
    expect(cache.stats().entries).toBe(0);
    expect(rig.stats().triangles.hair).toBeGreaterThan(0);
    expect(rig.stats().triangles.hair).toBeLessThanOrEqual(findItem("hair.02")!.triangleBudget);
    rig.apply(DEFAULT_APPEARANCE);
    expect(rig.stats().hair).toBe("hair.01");
    expect(hair01).toBeDefined();
    expect(rig.stats().missing).toEqual([]);
    rig.dispose();
  });

  it("szybka zmiana przed wczytaniem: nieaktualne wczytanie jest zwalniane, bez duchów w scenie", async () => {
    const real = makeLoader();
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const { rig, find, cache } = await setup(async (url) => {
      await gate;
      return real.load(url);
    });
    rig.apply(DEFAULT_APPEARANCE);
    rig.apply(tripo());
    expect(rig.stats().loading).toEqual([HAIR_ID]);
    rig.apply(withAppearance(DEFAULT_APPEARANCE, { hairStyleId: "hair.02" }));
    expect(rig.stats().loading).toEqual([]);
    open();
    await vi.waitFor(() => expect(cache.stats().entries).toBe(0), { timeout: 15000 });
    expect(rig.stats().hair).toBe("hair.02");
    expect(find(`appearance-${HAIR_ID}-pivot`)).toBeUndefined();
    expect(cache.stats().entries).toBe(0);
    rig.dispose();
  }, 20000);

  it("kolor: wspólny materiał z pliku zostaje nietknięty, instancja ma własny klon; domyślny kolor = oryginał", async () => {
    const { load } = makeLoader();
    const { rig, nextUpdate, find, cache } = await setup(load);
    const done = nextUpdate();
    rig.apply(tripo());
    await done;
    const mesh = find(`appearance-${HAIR_ID}`) as THREE.Mesh;
    const asset = await cache.acquire(`/characters/${file()}`);
    expect(mesh.material).not.toBe(asset.material);
    expect(asset.material.color.getHexString()).toBe("ffffff");
    expect(item().defaultColor).toBe("#ffffff");
    expect(rig.appearance?.hairColor).toBe("#ffffff");
    rig.apply(tripo({ hairColor: "#aa3366" }));
    // Bez tekstury (test) przebarwienie idzie przez kolor materiału; z teksturą działa shader z zachowaniem jasności tekstury.
    expect((mesh.material as THREE.MeshStandardMaterial).color.getHexString()).toBe("aa3366");
    expect(asset.material.color.getHexString()).toBe("ffffff");
    rig.apply(tripo());
    expect((mesh.material as THREE.MeshStandardMaterial).color.getHexString()).toBe("ffffff");
    cache.release(`/characters/${file()}`);
    rig.dispose();
  });

  it("widoczność fryzury przełącza się bez wymiany i zostaje po zmianie fryzury", async () => {
    const { load } = makeLoader();
    const { rig, nextUpdate, find } = await setup(load);
    const done = nextUpdate();
    rig.apply(tripo());
    await done;
    rig.setHairVisible(false);
    expect(find(`appearance-${HAIR_ID}-pivot`)!.visible).toBe(false);
    rig.apply(withAppearance(tripo(), { hairStyleId: "hair.01" }));
    expect(find("appearance-hair.01-pivot")!.visible).toBe(false);
    rig.setHairVisible(true);
    expect(find("appearance-hair.01-pivot")!.visible).toBe(true);
    rig.dispose();
  });

  it("błąd wczytania: zgłoszony w stats.missing, poprzednia fryzura zostaje, bez ponawiania w pętli", async () => {
    const { rig, nextUpdate } = await setup(() => Promise.reject(new Error("HTTP 404")));
    rig.apply(DEFAULT_APPEARANCE);
    const done = nextUpdate();
    rig.apply(tripo());
    await done;
    expect(rig.stats().hair).toBe("hair.01");
    expect(rig.stats().missing.map((m) => m.id)).toEqual([HAIR_ID]);
    expect(rig.stats().missing[0].reason).toContain("HTTP 404");
    rig.apply(tripo());
    expect(rig.stats().loading).toEqual([]);
    rig.dispose();
  });
});
