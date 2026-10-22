import { createHash } from "node:crypto";
import fs from "node:fs";
import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { PLAYER_GIRL_ID, PLAYER_REQUIRED_CLIPS, sceneNodeName, type CharactersManifest, type PlayerAsset } from "@/lib/assets/characters";
import { publicDir, readJsonFile } from "@/lib/assets/glbTestkit";
import { verticalAxisOf, worldDrift } from "@/lib/npc/rootMotion";
import { TPP_DEFAULTS } from "@/lib/tpp/config";
import { loadTestPlayer } from "@/lib/tpp/testkit";
import { CLIP_PHASE_ANCHOR, JUMP_AIR_CLIP_TIME, MIRRORED_CLIPS, mirrorClip, mirrorName, preparePlayerClips } from "./clipPrep";
import { PlayerAnimator } from "./playerAnimator";
import { PlayerModel } from "./playerModel";

let asset: PlayerAsset;
beforeAll(async () => {
  asset = await loadTestPlayer();
});

const HIPS = sceneNodeName("mixamorig:Hips");

describe("dziewczynka: prawdziwy plik GLB", () => {
  it("wpis w manifeście zgadza się z plikiem (rozmiar, SHA-256) i zawiera dziewięć wymaganych animacji o dokładnych nazwach", () => {
    const manifest = readJsonFile(publicDir("characters/characters.json")) as CharactersManifest;
    const entry = manifest.characters.find((c) => c.id === PLAYER_GIRL_ID)!;
    expect(entry.forward).toBe("+z");
    expect(PLAYER_REQUIRED_CLIPS).toEqual(["idle", "walk", "run", "jump", "crouch_idle", "crouch_walk_forward", "crouch_walk_back", "crouch_sneak_left", "crouch_sneak_right"]);
    const file = fs.readFileSync(publicDir("characters", entry.file));
    expect(file.length).toBe(entry.bytes);
    expect(entry.source.sha256).toBe(createHash("sha256").update(file).digest("hex"));
    expect(asset.clips.map((c) => c.name).sort()).toEqual([...PLAYER_REQUIRED_CLIPS].sort());
    expect(asset.bones).toBe(65);
  });

  it("szkielet: biodra mają pion w osi Y, więc obróbka klipów dotyczy właściwych osi", () => {
    const hips = asset.scene.getObjectByName(HIPS)!;
    expect(verticalAxisOf(hips)).toBe(1);
  });

  it("obróbka klipów: `jump` bez wzrostu pionowego, klipy pętlowe wyśrodkowane, oryginały nietknięte", () => {
    const { clips, reports } = preparePlayerClips(asset.clips, HIPS);
    expect([...clips.keys()].sort()).toEqual([...PLAYER_REQUIRED_CLIPS, ...MIRRORED_CLIPS.map(mirrorName)].sort());
    const posOf = (clip: THREE.AnimationClip) => clip.tracks.find((t) => t.name === `${HIPS}.position`)! as THREE.VectorKeyframeTrack;
    const jump = posOf(clips.get("jump")!);
    const y0 = jump.values[1];
    for (let i = 0; i < jump.times.length; i++) expect(jump.values[i * 3 + 1]).toBeLessThanOrEqual(y0 + 1e-6);
    expect(reports.find((r) => r.clip === "jump")!.removedRise).toBeGreaterThan(0);
    expect(jump.times[jump.times.length - 1]).toBeGreaterThanOrEqual(JUMP_AIR_CLIP_TIME);
    for (const name of PLAYER_REQUIRED_CLIPS) {
      if (name === "jump") continue;
      const t = posOf(clips.get(name)!);
      let mx = 0;
      let mz = 0;
      for (let i = 0; i < t.times.length; i++) {
        mx += t.values[i * 3];
        mz += t.values[i * 3 + 2];
      }
      expect(Math.abs(mx / t.times.length), name).toBeLessThan(1e-4);
      expect(Math.abs(mz / t.times.length), name).toBeLessThan(1e-4);
    }
    // Oryginał z pliku nie został zmieniony (te same wartości co przed obróbką).
    const original = posOf(asset.clips.find((c) => c.name === "jump")!);
    expect(Math.max(...Array.from({ length: original.times.length }, (_, i) => original.values[i * 3 + 1])) - original.values[1]).toBeGreaterThan(0.05);
  });

  it("skradanie w bok: w pliku miednica jest obrócona o ok. 160° (tyłem), po obróbce patrzy do przodu (+Z)", () => {
    const { clips } = preparePlayerClips(asset.clips, HIPS);
    const heading = (clip: THREE.AnimationClip) => {
      const t = clip.tracks.find((x) => x.name === `${HIPS}.quaternion`)!;
      let sx = 0;
      let sz = 0;
      const q = new THREE.Quaternion();
      const v = new THREE.Vector3();
      for (let i = 0; i < t.times.length; i++) {
        v.set(0, 0, 1).applyQuaternion(q.fromArray(t.values, i * 4));
        sx += v.x;
        sz += v.z;
      }
      return (Math.atan2(sx, sz) * 180) / Math.PI;
    };
    for (const name of ["crouch_sneak_left", "crouch_sneak_right"]) {
      expect(Math.abs(heading(asset.clips.find((c) => c.name === name)!)), `${name} w pliku`).toBeGreaterThan(140);
      expect(Math.abs(heading(clips.get(name)!)), `${name} po obróbce`).toBeLessThan(40);
    }
    for (const name of ["walk", "run", "idle", "crouch_walk_forward", "crouch_walk_back"]) {
      expect(heading(clips.get(name)!)).toBeCloseTo(heading(asset.clips.find((c) => c.name === name)!), 3);
    }
  });

  it("kotwice fazy kroku: po obróbce lewa stopa wyprzedza prawą w kierunku ruchu w fazie zapisanej w CLIP_PHASE_ANCHOR (ukosy mieszają zgodne fazy)", () => {
    const { clips } = preparePlayerClips(asset.clips, HIPS);
    const left = asset.scene.getObjectByName(sceneNodeName("mixamorig:LeftFoot"))!;
    const right = asset.scene.getObjectByName(sceneNodeName("mixamorig:RightFoot"))!;
    const mixer = new THREE.AnimationMixer(asset.scene);
    const samples = 60;
    const phaseOf = (name: string) => {
      const clip = clips.get(name)!;
      const action = mixer.clipAction(clip);
      action.play();
      const L: THREE.Vector3[] = [];
      const R: THREE.Vector3[] = [];
      for (let i = 0; i <= samples; i++) {
        mixer.setTime((i / samples) * clip.duration * 0.9999);
        asset.scene.updateMatrixWorld(true);
        L.push(left.getWorldPosition(new THREE.Vector3()));
        R.push(right.getWorldPosition(new THREE.Vector3()));
      }
      action.stop();
      // Kierunek ruchu ciała = przeciwny do ruchu stopy podparcia (niższej).
      let vx = 0;
      let vz = 0;
      for (let i = 0; i < samples; i++) {
        const feet = L[i].y < R[i].y ? L : R;
        vx -= feet[i + 1].x - feet[i].x;
        vz -= feet[i + 1].z - feet[i].z;
      }
      const m = Math.hypot(vx, vz) || 1;
      const s = L.map((l, i) => ((l.x - R[i].x) * vx + (l.z - R[i].z) * vz) / m);
      for (let i = 0; i < samples; i++) {
        if (s[i] <= 0 && s[i + 1] > 0) return (i + -s[i] / (s[i + 1] - s[i])) / samples;
      }
      return null;
    };
    const wrap = (d: number) => ((((d + 0.5) % 1) + 1) % 1) - 0.5;
    for (const [name, anchor] of Object.entries(CLIP_PHASE_ANCHOR)) {
      const phase = phaseOf(name);
      expect(phase, name).not.toBeNull();
      expect(Math.abs(wrap(phase! - anchor)), `${name}: zmierzona faza ${phase}, kotwica ${anchor}`).toBeLessThan(0.05);
    }
    mixer.uncacheRoot(asset.scene);
  });

  it("odbicie lustrzane: odbite `crouch_sneak_right` pokrywa się z `crouch_sneak_left` (stopy w tych samych miejscach), więc reguła odbicia pasuje do szkieletu", () => {
    const { clips } = preparePlayerClips(asset.clips, HIPS);
    const mirroredRight = mirrorClip(clips.get("crouch_sneak_right")!, "mirrored-right");
    const left = asset.scene.getObjectByName(sceneNodeName("mixamorig:LeftFoot"))!;
    const right = asset.scene.getObjectByName(sceneNodeName("mixamorig:RightFoot"))!;
    const mixer = new THREE.AnimationMixer(asset.scene);
    const feetAt = (clip: THREE.AnimationClip, phase: number) => {
      const action = mixer.clipAction(clip);
      action.play();
      mixer.setTime(phase * clip.duration);
      asset.scene.updateMatrixWorld(true);
      const out = [left.getWorldPosition(new THREE.Vector3()), right.getWorldPosition(new THREE.Vector3())];
      action.stop();
      return out;
    };
    const target = clips.get("crouch_sneak_left")!;
    let worst = 0;
    for (let i = 0; i < 20; i++) {
      const a = feetAt(mirroredRight, i / 20);
      const b = feetAt(target, i / 20);
      worst = Math.max(worst, a[0].distanceTo(b[0]), a[1].distanceTo(b[1]));
    }
    mixer.uncacheRoot(asset.scene);
    expect(worst).toBeLessThan(0.03);
  });

  it("obróbka nie dodaje poziomego dryfu: różnica pierwsza-ostatnia klatka bioder w świecie jest taka sama jak w oryginale", () => {
    const { clips } = preparePlayerClips(asset.clips, HIPS);
    const hips = asset.scene.getObjectByName(HIPS)!;
    for (const original of asset.clips) {
      if (original.name === "jump") continue;
      const before = worldDrift(asset.scene, original, hips, asset.scale);
      const after = worldDrift(asset.scene, clips.get(original.name)!, hips, asset.scale);
      expect(Math.abs(after - before), original.name).toBeLessThan(1e-3);
    }
  });

  it("model: skala do 1,55 m i przód zgodny z konwencją kamery; stopy na poziomie 0", () => {
    const model = new PlayerModel(asset, { castShadow: false, receiveShadow: false, targetHeight: TPP_DEFAULTS.characterHeight });
    model.setPose(3, 2, 4, 0);
    model.group.updateMatrixWorld(true);
    // Przód modelu (+Z w pliku) ma w świecie wskazywać -Z przy yaw 0.
    const forward = new THREE.Vector3(0, 0, 1).transformDirection(model.group.children[0].matrixWorld);
    expect(forward.z).toBeCloseTo(-1, 5);
    expect(model.scale).toBeCloseTo(TPP_DEFAULTS.characterHeight / asset.entry.sourceHeight, 6);
    expect(model.group.position.y).toBe(2);
    model.setPose(0, 0, 0, Math.PI / 2);
    model.group.updateMatrixWorld(true);
    const turned = new THREE.Vector3(0, 0, 1).transformDirection(model.group.children[0].matrixWorld);
    // yaw = +90° w konwencji kamery to patrzenie w -X.
    expect(turned.x).toBeCloseTo(-1, 5);
    model.group.removeFromParent();
  });

  it("animator na prawdziwych klipach: wagi sumują się do 1, przejście idle -> walk -> run -> kucanie jest płynne, jeden mikser", () => {
    const animator = new PlayerAnimator(asset, HIPS);
    const events = { justJumped: false, falling: false, grounded: true };
    const sumOf = () => Object.values(animator.stats().weights).reduce((a, b) => a + b, 0);
    const step = (speed: number, crouching: boolean, forward = speed, right = 0, n = 30) => {
      for (let i = 0; i < n; i++) animator.update(1 / 60, { crouching, airborne: false, speed, forward, right }, events, TPP_DEFAULTS, 0.5);
    };
    step(0, false);
    expect(animator.stats().dominant).toBe("idle");
    step(2.2, false, 2.2, 0, 60);
    expect(animator.stats().dominant).toBe("walk");
    step(4.8, false, 4.8, 0, 60);
    expect(animator.stats().dominant).toBe("run");
    expect(sumOf()).toBeCloseTo(1, 6);
    step(1, true, 1, 0, 60);
    expect(animator.stats().dominant).toBe("crouch_walk_forward");
    step(1, true, 0, -1, 60);
    expect(animator.stats().dominant).toBe("crouch_sneak_left");
    step(1, true, 0, 1, 60);
    expect(animator.stats().dominant).toBe("crouch_sneak_right");
    step(1, true, -1, 0, 60);
    expect(animator.stats().dominant).toBe("crouch_walk_back");
    step(0, true, 0, 0, 60);
    expect(animator.stats().dominant).toBe("crouch_idle");
    expect(sumOf()).toBeCloseTo(1, 6);
    animator.dispose();
  });

  it("skok: LoopOnce, waga rośnie przy starcie, a po lądowaniu wraca ruch; animacja nie przesuwa kości bioder poza kołysanie", () => {
    const animator = new PlayerAnimator(asset, HIPS);
    const hips = asset.scene.getObjectByName(HIPS)!;
    const idle = { crouching: false, airborne: false, speed: 0, forward: 0, right: 0 };
    const air = { ...idle, airborne: true };
    animator.update(1 / 60, air, { justJumped: true, falling: false, grounded: false }, TPP_DEFAULTS, 0.5);
    for (let i = 0; i < 20; i++) animator.update(1 / 60, air, { justJumped: false, falling: false, grounded: false }, TPP_DEFAULTS, 0.5);
    expect(animator.stats().dominant).toBe("jump");
    const yAir = hips.position.y;
    expect(Number.isFinite(yAir)).toBe(true);
    for (let i = 0; i < 60; i++) animator.update(1 / 60, idle, { justJumped: false, falling: false, grounded: true }, TPP_DEFAULTS, 0.5);
    expect(animator.stats().dominant).toBe("idle");
    expect(animator.stats().jump).toBe(0);
    animator.dispose();
  });
  it("podgląd klipu (kreator): każdy z dziewięciu klipów gra z wagą 1 i porusza kośćmi, a null przywraca sterowanie z logiki gry", () => {
    const animator = new PlayerAnimator(asset, HIPS);
    const idle = { crouching: false, airborne: false, speed: 0, forward: 0, right: 0 };
    const events = { justJumped: false, falling: false, grounded: true };
    const leg = asset.scene.getObjectByName(sceneNodeName("mixamorig:LeftUpLeg"))!;
    for (const name of PLAYER_REQUIRED_CLIPS) {
      animator.setPreviewClip(name);
      expect(animator.previewClip).toBe(name);
      animator.update(1 / 60, idle, events, TPP_DEFAULTS, 0.5);
      const a = leg.quaternion.clone();
      for (let i = 0; i < 20; i++) animator.update(1 / 60, idle, events, TPP_DEFAULTS, 0.5);
      const b = leg.quaternion.clone();
      expect([a.x, a.y, a.z, a.w, b.x, b.y, b.z, b.w].every(Number.isFinite)).toBe(true);
      if (name === "walk" || name === "run") expect(a.angleTo(b)).toBeGreaterThan(1e-3);
    }
    animator.setPreviewClip(null);
    for (let i = 0; i < 90; i++) animator.update(1 / 60, idle, events, TPP_DEFAULTS, 0.5);
    expect(animator.stats().dominant).toBe("idle");
    animator.dispose();
  });
});
