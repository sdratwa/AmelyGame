import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { sceneNodeName } from "@/lib/assets/characters";
import { CATALOG, DEFAULT_APPEARANCE, withAppearance } from "@/lib/character";
import { loadTestPlayer } from "@/lib/tpp/testkit";
import { AppearanceRig } from "./appearanceRig";

const budget = (id: string) => CATALOG.find((i) => i.id === id)!.triangleBudget;
const fresh = async () => {
  // Każdy test dostaje własną kopię zasobu: rig zmienia indeks siatki bazowej.
  const a = await loadTestPlayer();
  return { a, rig: new AppearanceRig(a) };
};
const named = (root: THREE.Object3D, name: string) => {
  let found: THREE.Object3D | undefined;
  root.traverse((o) => {
    if (o.name === name) found = o;
  });
  return found;
};

describe("AppearanceRig na prawdziwym GLB", () => {
  it("domyślny wygląd zakłada fryzurę, górę i dół w budżecie trójkątów i ukrywa część ciała pod ubraniem", async () => {
    const { rig } = await fresh();
    rig.apply(DEFAULT_APPEARANCE);
    const s = rig.stats();
    expect(s.missing).toEqual([]);
    expect([s.hair, s.top, s.bottom]).toEqual(["hair.01", "top.01", "bottom.01"]);
    expect(s.triangles.hair).toBeLessThanOrEqual(budget("hair.01"));
    expect(s.triangles.top).toBeLessThanOrEqual(budget("top.01"));
    expect(s.triangles.bottom).toBeLessThanOrEqual(budget("bottom.01"));
    expect(s.triangles.bodyHidden).toBeGreaterThan(0);
    expect(s.extraDrawCalls).toBe(3);
    rig.dispose();
  });

  it("ubranie to SkinnedMesh na tym samym szkielecie co ciało (animuje się z kośćmi ciała)", async () => {
    const { a, rig } = await fresh();
    rig.apply(DEFAULT_APPEARANCE);
    const clothes = new Set<THREE.SkinnedMesh>();
    a.scene.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh && o !== a.skinned) clothes.add(o as THREE.SkinnedMesh);
    });
    expect(clothes.size).toBe(2);
    for (const c of clothes) {
      expect(c.skeleton).toBe(a.skinned.skeleton);
      expect(c.skeleton.bones.length).toBe(65);
    }
    rig.dispose();
  });

  it("fryzura jest zamocowana do kości głowy i stoi dokładnie na środku głowy w pozie wiązania", async () => {
    const { a, rig } = await fresh();
    rig.apply(DEFAULT_APPEARANCE);
    const hair = named(a.scene, "appearance-hair.01-pivot")!;
    expect(hair).toBeDefined();
    let ancestor: THREE.Object3D | null = hair.parent;
    let underHead = false;
    while (ancestor) {
      if (ancestor.name === sceneNodeName("mixamorig:Head")) underHead = true;
      ancestor = ancestor.parent;
    }
    expect(underHead).toBe(true);
    a.scene.updateMatrixWorld(true);
    const expected = new THREE.Vector3(...rig.headMetrics.center).applyMatrix4(a.skinned.matrixWorld);
    expect(hair.getWorldPosition(new THREE.Vector3()).distanceTo(expected)).toBeLessThan(1e-3);

    // Obrót głowy zabiera fryzurę ze sobą: odległość od kości głowy się nie zmienia.
    const head = a.skinned.skeleton.bones.find((b) => b.name === sceneNodeName("mixamorig:Head"))!;
    const before = hair.getWorldPosition(new THREE.Vector3()).distanceTo(head.getWorldPosition(new THREE.Vector3()));
    const pos0 = hair.getWorldPosition(new THREE.Vector3());
    head.rotation.x += 0.8;
    a.scene.updateMatrixWorld(true);
    const after = hair.getWorldPosition(new THREE.Vector3()).distanceTo(head.getWorldPosition(new THREE.Vector3()));
    expect(after).toBeCloseTo(before, 4);
    expect(hair.getWorldPosition(new THREE.Vector3()).distanceTo(pos0)).toBeGreaterThan(0.005);
    rig.dispose();
  });

  it("zmiana fryzury wymienia tylko fryzurę: stary element znika, szkielet i ubrania zostają, a geometria jest zwolniona", async () => {
    const { a, rig } = await fresh();
    rig.apply(DEFAULT_APPEARANCE);
    const top = named(a.scene, "appearance-top.01");
    const bones = [...a.skinned.skeleton.bones];
    const oldHair = named(a.scene, "appearance-hair.01") as THREE.Mesh;
    let disposed = false;
    oldHair.geometry.addEventListener("dispose", () => (disposed = true));
    rig.apply(withAppearance(DEFAULT_APPEARANCE, { hairStyleId: "hair.02" }));
    expect(named(a.scene, "appearance-hair.01")).toBeUndefined();
    expect(named(a.scene, "appearance-hair.02")).toBeDefined();
    expect(disposed).toBe(true);
    expect(named(a.scene, "appearance-top.01")).toBe(top);
    expect(a.skinned.skeleton.bones).toEqual(bones);
    rig.dispose();
  });

  it("powtórne zastosowanie tego samego wyglądu niczego nie przebudowuje", async () => {
    const { a, rig } = await fresh();
    rig.apply(DEFAULT_APPEARANCE);
    const hair = named(a.scene, "appearance-hair.01");
    rig.apply({ ...DEFAULT_APPEARANCE });
    expect(named(a.scene, "appearance-hair.01")).toBe(hair);
    rig.dispose();
  });

  it("kolor każdego slotu jest niezależny", async () => {
    const { a, rig } = await fresh();
    rig.apply(DEFAULT_APPEARANCE);
    const colorOf = (n: string) => ((named(a.scene, n) as THREE.Mesh).material as THREE.MeshStandardMaterial).color.getHexString();
    const hairBefore = colorOf("appearance-hair.01");
    const bottomBefore = colorOf("appearance-bottom.01");
    rig.apply(withAppearance(DEFAULT_APPEARANCE, { topColor: "#ff0000" }));
    expect(colorOf("appearance-top.01")).toBe("ff0000");
    expect(colorOf("appearance-hair.01")).toBe(hairBefore);
    expect(colorOf("appearance-bottom.01")).toBe(bottomBefore);
    rig.dispose();
  });

  it("zdjęcie ubrań przywraca pełne ciało bazowe, a usunięcie rigu zostawia asset w stanie wyjściowym", async () => {
    const { a, rig } = await fresh();
    const original = a.skinned.geometry.getIndex()!;
    const total = original.count / 3;
    rig.apply(DEFAULT_APPEARANCE);
    expect(rig.stats().triangles.body).toBeLessThan(total);
    rig.apply({ ...DEFAULT_APPEARANCE, topId: null, bottomId: null, hairStyleId: null });
    expect(rig.stats().triangles.body).toBe(total);
    expect(rig.stats().extraDrawCalls).toBe(0);
    rig.apply(DEFAULT_APPEARANCE);
    rig.dispose();
    expect(a.skinned.geometry.getIndex()).toBe(original);
    expect(named(a.scene, "appearance-top.01")).toBeUndefined();
    expect(named(a.scene, "appearance-hair.01-pivot")).toBeUndefined();
  });

  it("dopasowanie fryzury: ustawienie, odczyt, reset i odrzucenie śmieci", async () => {
    const { a, rig } = await fresh();
    rig.apply(DEFAULT_APPEARANCE);
    const pivot = named(a.scene, "appearance-hair.01-pivot")!;
    const base = pivot.position.clone();
    rig.setFit("hair.01", { position: [0, 0.01, 0.02], rotationDeg: [5, 0, 0], scale: [1.1, 1.1, 1.1] });
    expect(pivot.position.y - base.y).toBeCloseTo(0.01, 6);
    expect(pivot.scale.x).toBeCloseTo(1.1, 6);
    expect(rig.getFit("hair.01").position).toEqual([0, 0.01, 0.02]);
    rig.setFit("hair.01", "śmieć");
    expect(Number.isFinite(pivot.scale.x)).toBe(true);
    rig.resetFit("hair.01");
    expect(pivot.position.distanceTo(base)).toBeLessThan(1e-9);
    rig.dispose();
  });

  it("powłoki ubrań mają skończone dane i wagi kości sumujące się do 1", async () => {
    const { a, rig } = await fresh();
    rig.apply(DEFAULT_APPEARANCE);
    for (const name of ["appearance-top.01", "appearance-bottom.01"]) {
      const g = (named(a.scene, name) as THREE.SkinnedMesh).geometry;
      const pos = g.getAttribute("position");
      const w = g.getAttribute("skinWeight");
      let bad = 0;
      for (let i = 0; i < pos.count; i++) {
        if (![pos.getX(i), pos.getY(i), pos.getZ(i)].every(Number.isFinite)) bad++;
        const sum = w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i);
        if (Math.abs(sum - 1) > 0.02) bad++;
      }
      expect(bad).toBe(0);
    }
    rig.dispose();
  });
});
