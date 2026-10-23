import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";
import type { PlayerAsset } from "@/lib/assets/characters";
import { TPP_DEFAULTS } from "@/lib/tpp/config";
import { loadTestPlayer } from "@/lib/tpp/testkit";
import { PlayerAnimator } from "../playerAnimator";
import { PlayerModel } from "../playerModel";
import { DEFAULT_LANTERN_CONFIG, type LanternConfig } from "./config";
import { LANTERN_HAND_BONE, findHandBone } from "./hand";
import { LanternSystem, type LanternFrameEnv } from "./system";

let asset: PlayerAsset;
beforeAll(async () => {
  asset = await loadTestPlayer();
});

const env = (): LanternFrameEnv => ({
  time: 0,
  dt: 1 / 30,
  daylight: 0,
  fogDensity: 0,
  camera: { x: 0, y: 1.6, z: 6 },
  fovRad: 1,
  viewportHeightPx: 1000,
  heightAt: null,
});

const cfg: LanternConfig = { ...DEFAULT_LANTERN_CONFIG, flickerEnabled: false };

type Pose = { name: string; intent: { crouching: boolean; airborne: boolean; speed: number; forward: number; right: number }; ev: { justJumped: boolean; falling: boolean; grounded: boolean } };
const POSES: Pose[] = [
  { name: "Idle", intent: { crouching: false, airborne: false, speed: 0, forward: 0, right: 0 }, ev: { justJumped: false, falling: false, grounded: true } },
  { name: "Walk", intent: { crouching: false, airborne: false, speed: 2.4, forward: 2.4, right: 0 }, ev: { justJumped: false, falling: false, grounded: true } },
  { name: "Run", intent: { crouching: false, airborne: false, speed: 5.2, forward: 5.2, right: 0 }, ev: { justJumped: false, falling: false, grounded: true } },
  { name: "Jump", intent: { crouching: false, airborne: true, speed: 0, forward: 0, right: 0 }, ev: { justJumped: true, falling: false, grounded: false } },
  { name: "Crouch", intent: { crouching: true, airborne: false, speed: 0, forward: 0, right: 0 }, ev: { justJumped: false, falling: false, grounded: true } },
  { name: "Sneak", intent: { crouching: true, airborne: false, speed: 1.2, forward: 1.2, right: 0 }, ev: { justJumped: false, falling: false, grounded: true } },
];

describe("lampa w dłoni prawdziwego modelu Mixamo", () => {
  it("szkielet ma kość prawej dłoni, a nazwa pochodzi z jednej stałej", () => {
    expect(LANTERN_HAND_BONE).toBe("mixamorig:RightHand");
    const hand = findHandBone(asset.scene);
    expect(hand).not.toBeNull();
    expect((hand as THREE.Bone).isBone).toBe(true);
    expect(findHandBone(new THREE.Group())).toBeNull();
  });

  it("zostaje przy dłoni w Idle, chodzie, biegu, skoku i kucaniu; zwisa w dół w spoczynku, ma rozmiar lampy w metrach", () => {
    const model = new PlayerModel(asset, { castShadow: false, receiveShadow: false });
    const scene = new THREE.Scene();
    scene.add(model.group);
    const animator = new PlayerAnimator(asset, model.hipsName);
    const system = new LanternSystem(cfg, { poolSize: 2, allowShadows: false, glowTextureSize: 8 });
    scene.add(system.group);
    const hand = findHandBone(asset.scene)!;
    const sources = [{ id: "local", enabled: true, hand, seed: 1, priority: true }];
    const handPos = new THREE.Vector3();
    const flamePos = new THREE.Vector3();
    const root = () => hand.children.find((c) => c.name === "oil-lantern")!;
    try {
      for (const pose of POSES) {
        for (let i = 0; i < 40; i++) {
          model.setPose(0, 0, 0, 0);
          animator.update(1 / 30, pose.intent, { ...pose.ev, justJumped: pose.ev.justJumped && i === 0 }, TPP_DEFAULTS, 0.6);
          system.update(sources, env());
        }
        expect(root(), pose.name).toBeDefined();
        hand.getWorldPosition(handPos);
        let anchor: THREE.Object3D | null = null;
        root().traverse((o) => {
          if (o.name === "oil-lantern-flame-anchor") anchor = o;
        });
        (anchor as unknown as THREE.Object3D).getWorldPosition(flamePos);
        // Płomień wisi blisko dłoni (lampa ma ~0,28 m wysokości) niezależnie od pozy.
        expect(flamePos.distanceTo(handPos), pose.name).toBeLessThan(0.45);
        expect(flamePos.distanceTo(handPos), pose.name).toBeGreaterThan(0.03);
        if (pose.name === "Idle") {
          // Ramię opuszczone: lampa zwisa pod dłonią, a nie sterczy nad nią.
          expect(handPos.y - flamePos.y, "Idle: lampa zwisa").toBeGreaterThan(0.1);
        }
      }
      // Rozmiar w świecie (kompensacja skali postaci): lampa mieści się w 0,2-0,45 m.
      const box = new THREE.Box3().setFromObject(root());
      const size = box.getSize(new THREE.Vector3());
      expect(Math.max(size.x, size.y, size.z)).toBeGreaterThan(0.2);
      expect(Math.max(size.x, size.y, size.z)).toBeLessThan(0.45);
    } finally {
      // Sprzątanie w kolejności jak w rendererze: najpierw lampy, potem model.
      system.dispose();
      expect(hand.children.some((c) => c.name === "oil-lantern")).toBe(false);
      animator.dispose();
      model.dispose();
    }
  });
});
