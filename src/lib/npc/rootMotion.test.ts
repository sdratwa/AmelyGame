import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { sceneNodeName, type TrollAsset } from "@/lib/assets/characters";
import { horizontalExcursion, measureRootMotion, nominalSpeed, poseClipFrom, stripRootMotion } from "./rootMotion";
import { loadTestTroll } from "./testkit";

const HIPS = sceneNodeName("mixamorig:Hips");
let asset: TrollAsset;
let walk: THREE.AnimationClip;
let angry: THREE.AnimationClip;
beforeAll(async () => {
  asset = await loadTestTroll();
  walk = asset.clips.find((c) => c.name === "walk")!;
  angry = asset.clips.find((c) => c.name === "angry_01")!;
});

const hipsTrack = (clip: THREE.AnimationClip) => clip.tracks.find((t) => t.name === `${HIPS}.position`)!;

describe("root motion: pomiar w oryginalnym klipie walk", () => {
  it("biodra przesuwają się o ok. 0,83 jednostki modelu na cykl w osi Z, a w X prawie wcale", () => {
    const m = measureRootMotion(walk, HIPS);
    expect(m.drift.z).toBeGreaterThan(0.8);
    expect(m.drift.z).toBeLessThan(0.86);
    expect(Math.abs(m.drift.x)).toBeLessThan(0.01);
    expect(Math.abs(m.drift.y)).toBeLessThan(0.01);
    expect(m.direction.z).toBeCloseTo(1, 2);
    expect(m.duration).toBeCloseTo(2.333, 2);
  });

  it("angry_01 prawie nie przesuwa bioder (zaczyna i kończy w tym samym miejscu)", () => {
    expect(measureRootMotion(angry, HIPS).stride).toBeLessThan(0.02);
  });
});

describe("root motion: usunięcie z klipu odtwarzanego w grze", () => {
  it("pierwsza i ostatnia klatka mają to samo położenie poziome (pętla bez skoku), a oryginał się nie zmienia", () => {
    const before = Array.from(hipsTrack(walk).values);
    const { clip, removed } = stripRootMotion(walk, HIPS);
    const v = hipsTrack(clip).values;
    const last = hipsTrack(clip).times.length - 1;
    expect(Math.abs(v[last * 3] - v[0])).toBeLessThan(1e-6);
    expect(Math.abs(v[last * 3 + 2] - v[2])).toBeLessThan(1e-6);
    expect(removed.stride).toBeGreaterThan(0.8);
    expect(Array.from(hipsTrack(walk).values)).toEqual(before);
    expect(clip).not.toBe(walk);
    expect(clip.name).toBe("walk");
    expect(clip.duration).toBe(walk.duration);
  });

  it("zachowuje pionowy ruch bioder oraz wszystkie pozostałe ścieżki szkieletu bez zmian", () => {
    const { clip } = stripRootMotion(walk, HIPS);
    expect(clip.tracks).toHaveLength(walk.tracks.length);
    const a = hipsTrack(walk).values;
    const b = hipsTrack(clip).values;
    let verticalRange = 0;
    for (let i = 0; i < hipsTrack(walk).times.length; i++) {
      expect(b[i * 3 + 1]).toBe(a[i * 3 + 1]);
      verticalRange = Math.max(verticalRange, Math.abs(a[i * 3 + 1] - a[1]));
    }
    expect(verticalRange).toBeGreaterThan(0.005);
    for (const track of walk.tracks) {
      if (track.name === hipsTrack(walk).name) continue;
      const same = clip.tracks.find((t) => t.name === track.name)!;
      expect(Array.from(same.values)).toEqual(Array.from(track.values));
      expect(Array.from(same.times)).toEqual(Array.from(track.times));
    }
  });

  it("poziome wychylenie bioder po usunięciu jest małe (kołysanie), a ruch świata + reszta ścieżki odtwarza oryginał", () => {
    const { clip, removed } = stripRootMotion(walk, HIPS);
    expect(horizontalExcursion(walk, HIPS)).toBeGreaterThan(0.8);
    expect(horizontalExcursion(clip, HIPS)).toBeLessThan(0.05);
    const a = hipsTrack(walk);
    const b = hipsTrack(clip);
    const t0 = a.times[0];
    const span = a.times[a.times.length - 1] - t0;
    for (let i = 0; i < a.times.length; i++) {
      const k = (a.times[i] - t0) / span;
      expect(b.values[i * 3 + 2] + removed.drift.z * k).toBeCloseTo(a.values[i * 3 + 2], 5);
      expect(b.values[i * 3] + removed.drift.x * k).toBeCloseTo(a.values[i * 3], 5);
    }
  });

  it("nominalna prędkość chodu: ok. 1,0 m/s przy skali 2,7 m (długość kroku z root motion, skala i czas cyklu)", () => {
    const { removed } = stripRootMotion(walk, HIPS);
    expect(nominalSpeed(removed, asset.scale)).toBeGreaterThan(0.95);
    expect(nominalSpeed(removed, asset.scale)).toBeLessThan(1.1);
  });

  it("klip bez ścieżki kości nie jest zmieniany", () => {
    const { clip, removed } = stripRootMotion(walk, "Nie_Ma");
    expect(removed.stride).toBe(0);
    expect(clip.tracks).toHaveLength(walk.tracks.length);
  });
});

describe("poza spoczynkowa (Idle) z klatki chodu", () => {
  it("obejmuje wszystkie kości, ma stałe wartości i nie zostawia szkieletu w innej pozie", () => {
    const bindHips = asset.scene.getObjectByName(HIPS)!.position.clone();
    const idle = poseClipFrom(asset.scene, walk, 0.067, "idle");
    expect(idle.name).toBe("idle");
    expect(idle.tracks.filter((t) => t.name.endsWith(".quaternion"))).toHaveLength(66);
    for (const t of idle.tracks) {
      const n = t.getValueSize();
      expect(Array.from(t.values.slice(0, n))).toEqual(Array.from(t.values.slice(n)));
    }
    expect(asset.scene.getObjectByName(HIPS)!.position.toArray()).toEqual(bindHips.toArray());
  });
});
