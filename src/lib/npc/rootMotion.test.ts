import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { sceneNodeName, type TrollAsset } from "@/lib/assets/characters";
import { measureStanceSpeed } from "./ground";
import { horizontalExcursion, measureRootMotion, nominalSpeed, poseClipFrom, stripRootMotion, verticalAxisOf, worldDrift } from "./rootMotion";
import { loadTestTroll } from "./testkit";
import { buildTrollAnimations, ROOT_MOTION_LIMIT } from "./troll";

const HIPS = sceneNodeName("mixamorig:Hips");
let asset: TrollAsset;
let walk: THREE.AnimationClip;
beforeAll(async () => {
  asset = await loadTestTroll();
  walk = asset.clips.find((c) => c.name === "Walk")!;
});

const hipsTrack = (clip: THREE.AnimationClip) => clip.tracks.find((t) => t.name === `${HIPS}.position`)!;
const hipsNode = () => asset.scene.getObjectByName(HIPS)!;
/** Węzeł `Troll_Rig` ma obrót 90° wokół X (Blender), więc "w górę" to lokalna oś Z ścieżek bioder. */
const UP = 2;

/**
 * Kopia klipu z dodanym liniowym przesunięciem bioder (jednostki lokalne szkieletu; oś Y lokalna węzła `Troll_Rig` to poziom
 * "do przodu" w świecie): symuluje animację z root motion, której plik od autora nie ma.
 */
function withRootMotion(clip: THREE.AnimationClip, amount: number): THREE.AnimationClip {
  const out = clip.clone();
  const track = hipsTrack(out);
  const last = track.times.length - 1;
  const t0 = track.times[0];
  for (let i = 0; i <= last; i++) track.values[i * 3 + 1] += (amount * (track.times[i] - t0)) / (track.times[last] - t0);
  return out;
}

describe("root motion w animacjach z pliku (Blender + Mixamo)", () => {
  it("wszystkie 7 klipów chodzi w miejscu: biodra wracają na to samo miejsce w świecie (brak root motion)", () => {
    for (const clip of asset.clips) {
      expect(worldDrift(asset.scene, clip, hipsNode(), asset.scale), clip.name).toBeLessThan(ROOT_MOTION_LIMIT);
      const track = hipsTrack(clip);
      const last = track.times.length - 1;
      for (let k = 0; k < 3; k++) expect(Math.abs(track.values[last * 3 + k] - track.values[k]), `${clip.name} oś ${k}`).toBeLessThan(1e-3);
    }
  });

  it("Walk ma ruch poziomy bioder tylko jako kołysanie (bez dryfu), a pionowy ruch bioder istnieje", () => {
    expect(verticalAxisOf(hipsNode())).toBe(UP);
    expect(measureRootMotion(walk, HIPS, UP).stride).toBeLessThan(1e-3);
    const track = hipsTrack(walk);
    let range = 0;
    for (let i = 0; i < track.times.length; i++) range = Math.max(range, Math.abs(track.values[i * 3 + UP] - track.values[UP]));
    expect(range).toBeGreaterThan(0.003);
  });

  it("zestaw animacji trolla nie usuwa niczego z klipów z pliku (nie ma czego), a mierzy ruch każdego", () => {
    const set = buildTrollAnimations(asset);
    expect(set.stripped).toEqual([]);
    expect(Object.keys(set.hipsDrift).sort()).toEqual(asset.clips.map((c) => c.name).sort());
    expect(set.clips).toHaveLength(7);
    for (const c of set.clips) expect(asset.clips).toContain(c);
  });

  it("prędkość patrolu jest zmierzona z ruchu stopy w fazie podparcia: ok. 1,1 m/s dla Walk 1,43 s i trolla 2,7 m", () => {
    const toes = ["mixamorig:LeftToeBase", "mixamorig:RightToeBase"].map((n) => asset.scene.getObjectByName(sceneNodeName(n))!);
    const v = measureStanceSpeed(asset.scene, walk, toes, asset.scale);
    expect(v).toBeGreaterThan(0.9);
    expect(v).toBeLessThan(1.4);
    expect(buildTrollAnimations(asset).nominalSpeed).toBeCloseTo(v, 6);
    expect(measureStanceSpeed(asset.scene, asset.clips.find((c) => c.name === "Idle")!, toes, asset.scale)).toBeLessThan(0.05);
  });
});

describe("root motion: wykrywanie i usuwanie w klipie z przesunięciem (zabezpieczenie na przyszłe eksporty)", () => {
  it("klip z dodanym przesunięciem ma dryf w świecie powyżej limitu, a po usunięciu pętla wraca na to samo miejsce", () => {
    const drifting = withRootMotion(walk, 0.8);
    expect(worldDrift(asset.scene, drifting, hipsNode(), asset.scale)).toBeGreaterThan(1);
    const before = Array.from(hipsTrack(drifting).values);
    const { clip, removed } = stripRootMotion(drifting, HIPS, UP);
    expect(removed.stride).toBeCloseTo(0.8, 3);
    expect(worldDrift(asset.scene, clip, hipsNode(), asset.scale)).toBeLessThan(ROOT_MOTION_LIMIT);
    expect(Array.from(hipsTrack(drifting).values)).toEqual(before);
    expect(clip).not.toBe(drifting);
    expect(clip.name).toBe("Walk");
    expect(clip.duration).toBe(drifting.duration);
  });

  it("zachowuje pionowy ruch bioder oraz wszystkie pozostałe ścieżki szkieletu bez zmian", () => {
    const drifting = withRootMotion(walk, 0.8);
    const { clip } = stripRootMotion(drifting, HIPS, UP);
    expect(clip.tracks).toHaveLength(drifting.tracks.length);
    const a = hipsTrack(drifting).values;
    const b = hipsTrack(clip).values;
    for (let i = 0; i < hipsTrack(drifting).times.length; i++) expect(b[i * 3 + UP]).toBe(a[i * 3 + UP]);
    for (const track of drifting.tracks) {
      if (track.name === hipsTrack(drifting).name) continue;
      const same = clip.tracks.find((t) => t.name === track.name)!;
      expect(Array.from(same.values)).toEqual(Array.from(track.values));
      expect(Array.from(same.times)).toEqual(Array.from(track.times));
    }
  });

  it("poziome wychylenie bioder po usunięciu wraca do kołysania, a ruch świata + reszta ścieżki odtwarza oryginał", () => {
    const drifting = withRootMotion(walk, 0.8);
    const { clip, removed } = stripRootMotion(drifting, HIPS, UP);
    expect(horizontalExcursion(drifting, HIPS, UP)).toBeGreaterThan(0.7);
    expect(horizontalExcursion(clip, HIPS, UP)).toBeLessThan(0.05);
    const a = hipsTrack(drifting);
    const b = hipsTrack(clip);
    const t0 = a.times[0];
    const span = a.times[a.times.length - 1] - t0;
    for (let i = 0; i < a.times.length; i++) {
      const k = (a.times[i] - t0) / span;
      expect(b.values[i * 3] + removed.drift.x * k).toBeCloseTo(a.values[i * 3], 5);
      expect(b.values[i * 3 + 1] + removed.drift.y * k).toBeCloseTo(a.values[i * 3 + 1], 5);
    }
  });

  it("nominalSpeed: długość kroku, skala i czas cyklu", () => {
    expect(nominalSpeed({ drift: { x: 0, y: 0, z: 1 }, duration: 2, stride: 1, direction: { x: 0, z: 1 } }, 2.5)).toBeCloseTo(1.25, 6);
    expect(nominalSpeed({ drift: { x: 0, y: 0, z: 0 }, duration: 0, stride: 0, direction: { x: 0, z: 0 } }, 2.5)).toBe(0);
  });

  it("klip bez ścieżki kości nie jest zmieniany", () => {
    const { clip, removed } = stripRootMotion(walk, "Nie_Ma");
    expect(removed.stride).toBe(0);
    expect(clip.tracks).toHaveLength(walk.tracks.length);
  });
});

describe("poza z klipu (klip jednej pozy)", () => {
  it("obejmuje wszystkie kości skóry, ma stałe wartości i nie zostawia szkieletu w innej pozie", () => {
    const bindHips = asset.scene.getObjectByName(HIPS)!.position.clone();
    const pose = poseClipFrom(asset.scene, walk, 0.5, "pose");
    expect(pose.name).toBe("pose");
    expect(pose.tracks.filter((t) => t.name.endsWith(".quaternion"))).toHaveLength(asset.skinned.skeleton.bones.length);
    for (const t of pose.tracks) {
      const n = t.getValueSize();
      expect(Array.from(t.values.slice(0, n))).toEqual(Array.from(t.values.slice(n)));
    }
    expect(asset.scene.getObjectByName(HIPS)!.position.toArray()).toEqual(bindHips.toArray());
  });
});
