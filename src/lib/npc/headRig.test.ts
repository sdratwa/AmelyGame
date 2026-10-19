import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { rngStream } from "@/lib/game/core/rng";
import { sceneNodeName } from "@/lib/assets/characters";
import { BoneOffset, DEFAULT_HEAD_LOOK, HeadLook, HeadRig, lookRotation } from "./headRig";
import { boneCentroid, headHeading, loadTestDeer } from "./testkit";

const DEG = Math.PI / 180;
const simulate = (look: HeadLook, seconds: number, intent: Parameters<HeadLook["update"]>[1], fps = 60) => {
  const samples: { yaw: number; pitch: number }[] = [];
  for (let i = 0; i < seconds * fps; i++) {
    look.update(1 / fps, intent);
    samples.push({ yaw: look.yaw, pitch: look.pitch });
  }
  return samples;
};

describe("HeadLook: rozglądanie się", () => {
  it("rozgląda się w obie strony w granicach zakresu i wraca do pozycji neutralnej (0°)", () => {
    const look = new HeadLook(rngStream(1, "look"));
    const samples = simulate(look, 120, { kind: "free", walking: false });
    const yaws = samples.map((s) => s.yaw);
    expect(Math.max(...yaws)).toBeGreaterThan(DEFAULT_HEAD_LOOK.yawRange[0] * 0.8);
    expect(Math.min(...yaws)).toBeLessThan(-DEFAULT_HEAD_LOOK.yawRange[0] * 0.8);
    // Spokojne spojrzenia nie przekraczają zakresu (z małym zapasem na przeregulowanie), a pitch jest drobny.
    expect(Math.max(...yaws.map(Math.abs))).toBeLessThan(DEFAULT_HEAD_LOOK.yawRange[1] * 1.08);
    expect(Math.max(...samples.map((s) => Math.abs(s.pitch)))).toBeLessThan(DEFAULT_HEAD_LOOK.pitchRange * 1.2);
    // Część czasu spędza na wprost (pozycja neutralna).
    const neutral = samples.filter((s) => Math.abs(s.yaw) < 3 * DEG).length / samples.length;
    expect(neutral).toBeGreaterThan(0.3);
    expect(neutral).toBeLessThan(0.9);
  });

  it("ruch jest płynny: prędkość kątowa ograniczona, bez skoków i bez przeregulowania powyżej celu", () => {
    for (const fps of [30, 60, 144]) {
      const look = new HeadLook(rngStream(2, "look"));
      const samples = simulate(look, 90, { kind: "free", walking: false }, fps);
      let maxRate = 0;
      for (let i = 1; i < samples.length; i++) maxRate = Math.max(maxRate, Math.abs(samples[i].yaw - samples[i - 1].yaw) * fps);
      expect(maxRate, `${fps} FPS`).toBeLessThanOrEqual(DEFAULT_HEAD_LOOK.maxRate * 1.05);
    }
  });

  it("podczas marszu rozglądanie jest mniejsze niż na postoju", () => {
    const range = (walking: boolean) => {
      const look = new HeadLook(rngStream(3, "look"));
      return Math.max(...simulate(look, 200, { kind: "free", walking }).map((s) => Math.abs(s.yaw)));
    };
    expect(range(true)).toBeLessThan(range(false));
    expect(range(true)).toBeLessThan(DEFAULT_HEAD_LOOK.walkYawRange[1] * 1.1);
  });

  it("jest deterministyczne dla tego samego strumienia losowego", () => {
    const a = simulate(new HeadLook(rngStream(9, "look")), 30, { kind: "free", walking: false });
    const b = simulate(new HeadLook(rngStream(9, "look")), 30, { kind: "free", walking: false });
    expect(a).toEqual(b);
    const c = simulate(new HeadLook(rngStream(10, "look")), 30, { kind: "free", walking: false });
    expect(c).not.toEqual(a);
  });

  it("patrzy na cel (przycięty do zakresu szyi) i po utracie celu płynnie wraca do neutralnej pozycji", () => {
    const look = new HeadLook(rngStream(4, "look"));
    simulate(look, 3, { kind: "watch", yaw: 0.6, pitch: 0.1 });
    expect(look.yaw).toBeCloseTo(0.6, 1);
    expect(look.pitch).toBeCloseTo(0.1, 1);
    expect(look.isWatching).toBe(true);
    simulate(look, 3, { kind: "watch", yaw: 3, pitch: 1 });
    expect(look.yaw).toBeCloseTo(DEFAULT_HEAD_LOOK.watchYawLimit, 1);
    expect(look.pitch).toBeCloseTo(DEFAULT_HEAD_LOOK.watchPitchLimit, 1);
    // Po utracie celu głowa wraca do 0 bez skoku (kroki mniejsze niż prędkość maksymalna) i bez natychmiastowego rozglądania.
    const back = simulate(look, 1.5, { kind: "free", walking: false });
    expect(look.isWatching).toBe(false);
    for (let i = 1; i < back.length; i++) expect(Math.abs(back[i].yaw - back[i - 1].yaw) * 60).toBeLessThanOrEqual(DEFAULT_HEAD_LOOK.maxRate * 1.05);
    expect(Math.abs(back[back.length - 1].yaw)).toBeLessThan(0.2);
  });
});

describe("BoneOffset i HeadRig na kościach jelenia", () => {
  it("nakładka nie kumuluje się w nieskończoność na zamrożonej pozie (mikser nie nadpisuje kości)", () => {
    const bone = new THREE.Object3D();
    bone.quaternion.setFromEuler(new THREE.Euler(0.1, 0.2, 0.3));
    const base = bone.quaternion.clone();
    const offset = new BoneOffset(bone);
    const q = lookRotation(0.4, 0.1);
    offset.apply(q);
    const first = bone.quaternion.clone();
    for (let i = 0; i < 500; i++) offset.apply(q);
    expect(bone.quaternion.angleTo(first)).toBeLessThan(1e-6);
    expect(bone.quaternion.angleTo(base)).toBeGreaterThan(0.1);
    offset.release();
    expect(bone.quaternion.angleTo(base)).toBeLessThan(1e-6);
  });

  it("nowa poza z miksera zastępuje bazę (nakładka liczy od najnowszej pozy, nie od starej)", () => {
    const bone = new THREE.Object3D();
    const offset = new BoneOffset(bone);
    const q = lookRotation(0.5, 0);
    offset.apply(q);
    const mixerPose = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.4));
    bone.quaternion.copy(mixerPose);
    offset.apply(q);
    const expected = mixerPose.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.5));
    expect(bone.quaternion.angleTo(expected)).toBeLessThan(1e-6);
  });

  it("spojrzenie obraca pysk w odpowiednią stronę: yaw dodatni w lewo jelenia, pitch dodatni w górę; neutralne ustawia głowę do przodu", async () => {
    const asset = await loadTestDeer();
    const rig = new HeadRig({ head: asset.scene.getObjectByName(sceneNodeName(asset.entry.head.bone))!, neck: asset.scene.getObjectByName("tripoSpine_4"), correction: asset.entry.head });
    rig.apply({ yaw: 0, pitch: 0 });
    const neutral = headHeading(asset).yawDeg;
    expect(Math.abs(neutral)).toBeLessThan(8);
    rig.apply({ yaw: 0.6, pitch: 0 });
    const left = headHeading(asset).yawDeg;
    rig.apply({ yaw: -0.6, pitch: 0 });
    const right = headHeading(asset).yawDeg;
    expect(left - neutral).toBeGreaterThan(25);
    expect(left - neutral).toBeLessThan(40);
    expect(neutral - right).toBeGreaterThan(25);
    rig.apply({ yaw: 0, pitch: 0 });
    expect(Math.abs(headHeading(asset).yawDeg - neutral)).toBeLessThan(0.5);
    const y = (p: number) => {
      rig.apply({ yaw: 0, pitch: p });
      asset.scene.updateMatrixWorld(true);
      asset.skinned.skeleton.update();
      return boneCentroid(asset, "bone_21").y;
    };
    expect(y(0.2)).toBeGreaterThan(y(0));
    expect(y(-0.2)).toBeLessThan(y(0));
    rig.dispose();
    asset.dispose();
  });
});
