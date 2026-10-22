import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CLIP_YAW_CORRECTION_DEG, JUMP_AIR_CLIP_TIME, mirrorClip, preparePlayerClips, recenterLoopClip, rotateClipYaw, stripJumpRise } from "./clipPrep";

const BONE = "mixamorigHips";

function clipOf(name: string, times: number[], points: [number, number, number][]): THREE.AnimationClip {
  const track = new THREE.VectorKeyframeTrack(`${BONE}.position`, times, points.flat());
  const rot = new THREE.QuaternionKeyframeTrack(`${BONE}.quaternion`, times, times.flatMap(() => [0, 0, 0, 1]));
  return new THREE.AnimationClip(name, -1, [track, rot]);
}

const positions = (clip: THREE.AnimationClip) => Array.from(clip.tracks.find((t) => t.name === `${BONE}.position`)!.values);

describe("clipPrep: root motion", () => {
  it("klip pętlowy: poziomą średnią (X, Z) usuwa, pion i kołysanie zostają, oryginał bez zmian", () => {
    const clip = clipOf("crouch_sneak_left", [0, 0.5, 1], [[1, 0.9, 2], [1.2, 0.8, 2.1], [1, 0.9, 1.9]]);
    const before = positions(clip);
    const { clip: out, report } = recenterLoopClip(clip, BONE);
    const p = positions(out);
    const meanX = (p[0] + p[3] + p[6]) / 3;
    const meanZ = (p[2] + p[5] + p[8]) / 3;
    expect(meanX).toBeCloseTo(0, 6);
    expect(meanZ).toBeCloseTo(0, 6);
    expect([p[1], p[4], p[7]]).toEqual([before[1], before[4], before[7]]);
    expect(p[3] - p[0]).toBeCloseTo(before[3] - before[0], 6);
    expect(positions(clip)).toEqual(before);
    expect(out).not.toBe(clip);
    expect(report.removedMean.x).toBeCloseTo((1 + 1.2 + 1) / 3, 6);
  });

  it("skok: usuwa tylko wzrost bioder ponad start, dół i Z zostają", () => {
    const clip = clipOf("jump", [0, 0.3, 0.667, 0.867], [[0, 1, 0], [0.1, 1.6, 0.4], [0, 1.0, 0.3], [0, 0.8, 0.1]]);
    const { clip: out, report } = stripJumpRise(clip, BONE);
    const p = positions(out);
    [1, 1, 1, 0.8].forEach((v, i) => expect(p[i * 3 + 1]).toBeCloseTo(v, 5));
    [0, 0.4, 0.3, 0.1].forEach((v, i) => expect(p[i * 3 + 2]).toBeCloseTo(v, 5));
    expect(p[3]).toBeCloseTo(0.1, 5);
    expect(report.removedRise).toBeCloseTo(0.6, 6);
    expect(positions(clip)[4]).toBeCloseTo(1.6, 5);
  });

  it("zachowuje ścieżki obrotów i czas trwania", () => {
    const clip = clipOf("jump", [0, 0.5, 0.867], [[0, 1, 0], [0, 1.4, 0], [0, 1, 0]]);
    const out = stripJumpRise(clip, BONE).clip;
    expect(out.tracks).toHaveLength(2);
    expect(out.duration).toBeCloseTo(clip.duration, 9);
    expect(out.tracks[1].name).toBe(`${BONE}.quaternion`);
  });

  it("preparePlayerClips: skok dostaje inną obróbkę niż klipy pętlowe", () => {
    const loop = clipOf("walk", [0, 1], [[1, 1, 1], [1, 1, 1]]);
    const jump = clipOf("jump", [0, 1], [[0, 1, 0], [0, 2, 0]]);
    const { clips, reports } = preparePlayerClips([loop, jump], BONE);
    expect(positions(clips.get("walk")!)).toEqual([0, 1, 0, 0, 1, 0]);
    expect(positions(clips.get("jump")!)[4]).toBe(1);
    expect(reports.map((r) => r.clip)).toEqual(["walk", "jump"]);
  });

  it("czas lotu w klipie skoku to 0,667 s (z pomiaru pliku)", () => {
    expect(JUMP_AIR_CLIP_TIME).toBeCloseTo(0.667, 3);
  });

  it("rotateClipYaw: obraca obroty i przesunięcie bioder o zadany kąt wokół osi pionowej, oryginał bez zmian", () => {
    const clip = new THREE.AnimationClip("x", -1, [
      new THREE.VectorKeyframeTrack(`${BONE}.position`, [0, 1], [1, 0.9, 2, 1, 0.9, 2]),
      new THREE.QuaternionKeyframeTrack(`${BONE}.quaternion`, [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
    ]);
    const out = rotateClipYaw(clip, BONE, Math.PI);
    const p = out.tracks[0].values;
    expect(p[0]).toBeCloseTo(-1, 5);
    expect(p[1]).toBeCloseTo(0.9, 5);
    expect(p[2]).toBeCloseTo(-2, 5);
    // Przód (+Z) po obrocie o 180° wskazuje -Z.
    const q = new THREE.Quaternion().fromArray(out.tracks[1].values, 0);
    expect(new THREE.Vector3(0, 0, 1).applyQuaternion(q).z).toBeCloseTo(-1, 5);
    expect(Array.from(clip.tracks[1].values)).toEqual([0, 0, 0, 1, 0, 0, 0, 1]);
    expect(rotateClipYaw(clip, BONE, 0).tracks[0].values).toEqual(clip.tracks[0].values);
  });

  it("korekta kierunku dotyczy tylko klipów skradania w bok i trafia do raportu", () => {
    expect(Object.keys(CLIP_YAW_CORRECTION_DEG).sort()).toEqual(["crouch_sneak_left", "crouch_sneak_right"]);
    const left = clipOf("crouch_sneak_left", [0, 1], [[0, 1, 0], [0, 1, 0]]);
    const walk = clipOf("walk", [0, 1], [[0, 1, 0], [0, 1, 0]]);
    const { clips, reports } = preparePlayerClips([left, walk], BONE);
    const q = new THREE.Quaternion().fromArray(clips.get("crouch_sneak_left")!.tracks[1].values, 0);
    expect(new THREE.Vector3(0, 0, 1).applyQuaternion(q).z).toBeCloseTo(-1, 5);
    const q2 = new THREE.Quaternion().fromArray(clips.get("walk")!.tracks[1].values, 0);
    expect(new THREE.Vector3(0, 0, 1).applyQuaternion(q2).z).toBeCloseTo(1, 5);
    expect(reports.map((r) => r.yawCorrectionDeg)).toEqual([180, 0]);
  });

  it("mirrorClip: zamienia strony kości, neguje Y i Z obrotu oraz X pozycji; oryginał bez zmian", () => {
    const clip = new THREE.AnimationClip("c", -1, [
      new THREE.QuaternionKeyframeTrack("mixamorigLeftUpLeg.quaternion", [0, 1], [0.1, 0.2, 0.3, 0.9, 0.1, 0.2, 0.3, 0.9]),
      new THREE.VectorKeyframeTrack("mixamorigHips.position", [0, 1], [0.5, 1, 2, 0.5, 1, 2]),
      new THREE.QuaternionKeyframeTrack("mixamorigSpine.quaternion", [0, 1], [0, 0.2, 0.1, 0.97, 0, 0.2, 0.1, 0.97]),
    ]);
    const m = mirrorClip(clip);
    expect(m.name).toBe("c_m");
    expect(m.tracks.map((t) => t.name)).toEqual(["mixamorigRightUpLeg.quaternion", "mixamorigHips.position", "mixamorigSpine.quaternion"]);
    expect(Array.from(m.tracks[0].values.slice(0, 4)).map((x) => +x.toFixed(4))).toEqual([0.1, -0.2, -0.3, 0.9]);
    expect(m.tracks[1].values[0]).toBeCloseTo(-0.5, 6);
    expect(m.tracks[1].values[2]).toBeCloseTo(2, 6);
    expect(clip.tracks[0].name).toBe("mixamorigLeftUpLeg.quaternion");
    expect(clip.tracks[0].values[1]).toBeCloseTo(0.2, 6);
  });

  it("preparePlayerClips dodaje lustrzane kopie tylko dla chodu w kuckach do przodu i do tyłu", () => {
    const names = ["crouch_walk_forward", "crouch_walk_back", "crouch_sneak_left", "walk"];
    const { clips } = preparePlayerClips(names.map((n) => clipOf(n, [0, 1], [[0, 1, 0], [0, 1, 0]])), BONE);
    expect([...clips.keys()].sort()).toEqual([...names, "crouch_walk_forward_m", "crouch_walk_back_m"].sort());
  });
});
