import { playerLabelVisible } from "@/lib/hideseek/visibility";
import * as THREE from "three";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { type PlayerAsset, sceneNodeName } from "../assets/characters";
import { PlayerModel } from "./playerModel";
import { PlayerAnimator } from "./playerAnimator";
import { TPP_DEFAULTS } from "../tpp/config";
import type { Appearances, Player } from "../multiplayer/protocol";
import { findHandBone } from "./lantern/hand";
import { AppearanceRig } from "./appearance/appearanceRig";
import { DEFAULT_APPEARANCE, devFitOverrides, normalizeAppearance, sameAppearance, type CharacterAppearanceV1 } from "@/lib/character";

/**
 * Czysty wzorzec dla graczy zdalnych: kopia sceny i geometrii zrobiona PRZED założeniem `AppearanceRig` lokalnemu graczowi.
 * Klonowanie `SkeletonUtils.clone` współdzieli geometrie i materiały, a rig zmienia indeksy ciała i dokłada siatki ubrań;
 * wzorzec zrobiony z żywego modelu lokalnego dziedziczyłby jego ubranie (i kolory) oraz maskę ciała.
 */
export function createRemoteTemplate(source: PlayerAsset): PlayerAsset {
  const scene = clone(source.scene);
  const skinned = scene.getObjectByName(sceneNodeName(source.entry.meshNode)) as THREE.SkinnedMesh;
  skinned.geometry = skinned.geometry.clone();
  return { ...source, scene, skinned, dispose: () => disposeTemplate(skinned) };
}

function disposeTemplate(skinned: THREE.SkinnedMesh) {
  skinned.geometry.dispose();
  skinned.skeleton.dispose();
}

export class RemotePlayers {
  private actors = new Map<
    string,
    {
      model: PlayerModel;
      anim: PlayerAnimator;
      jump: number;
      label: THREE.Sprite;
      rig: AppearanceRig | null;
      applied: CharacterAppearanceV1 | null;
      /** Kość prawej dłoni (do niej przypinamy lampę naftową). */
      hand: THREE.Object3D | null;
    }
  >();
  constructor(
    private scene: THREE.Scene,
    private template: PlayerAsset,
  ) {}
  /** Kość dłoni gracza zdalnego (null, gdy gracza nie ma albo szkielet jej nie ma). */
  handBone(playerId: string): THREE.Object3D | null {
    return this.actors.get(playerId)?.hand ?? null;
  }
  /** `showNames`: czy pokazywać nazwy nad postaciami (ustawienie gry); ukrycie nie usuwa tekstury, więc przełącznik jest tani. */
  update(players: Player[], dt: number, appearances: Appearances = {}, showNames = true) {
    for (const [id, a] of this.actors)
      if (!players.some((p) => p.playerId === id)) {
        a.anim.dispose();
        a.rig?.dispose();
        a.model.group.removeFromParent();
        const skeletons = new Set<THREE.Skeleton>();
        a.model.asset.scene.traverse((node) => {
          if ((node as THREE.SkinnedMesh).isSkinnedMesh)
            skeletons.add((node as THREE.SkinnedMesh).skeleton);
        });
        for (const skeleton of skeletons) skeleton.dispose();
        a.model.asset.skinned.geometry.dispose();
        a.label.material.map?.dispose();
        a.label.material.dispose();
        this.actors.delete(id);
      }
    for (const p of players) {
      let a = this.actors.get(p.playerId);
      if (!a) {
        const scene = clone(this.template.scene);
        const skinned = scene.getObjectByName(
          sceneNodeName(this.template.entry.meshNode),
        ) as THREE.SkinnedMesh;
        // Własna geometria: rig zdalnego gracza zmienia indeks ciała (ukrywa fragmenty pod ubraniem).
        skinned.geometry = skinned.geometry.clone();
        const asset = {
          ...this.template,
          scene,
          skinned,
          dispose: () => skinned.skeleton.dispose(),
        };
        const model = new PlayerModel(asset, {
          castShadow: true,
          receiveShadow: true,
        });
        const anim = new PlayerAnimator(asset, model.hipsName);
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 64;
        const ctx = canvas.getContext("2d")!;
        ctx.font = "bold 26px sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = "white";
        ctx.fillText(p.name, 128, 40);
        const label = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: new THREE.CanvasTexture(canvas),
            depthTest: false,
          }),
        );
        label.position.y = 2;
        label.scale.set(2, 0.5, 1);
        model.group.add(label);
        this.scene.add(model.group);
        let rig: AppearanceRig | null = null;
        try {
          // Własny rig z własnymi materiałami: kolor ubrania jednego gracza nie dotyczy pozostałych.
          rig = new AppearanceRig(asset, { castShadow: true, receiveShadow: true, fits: devFitOverrides() });
        } catch (e) {
          console.error(e);
          rig?.dispose();
          rig = null;
        }
        a = { model, anim, jump: p.jumpSequence, label, rig, applied: null, hand: findHandBone(scene) };
        this.actors.set(p.playerId, a);
      }
      if (a.rig) {
        const wanted = normalizeAppearance(appearances[p.playerId] ?? DEFAULT_APPEARANCE);
        if (!a.applied || !sameAppearance(a.applied, wanted)) {
          a.applied = wanted;
          a.rig.apply(wanted);
        }
      }
      a.label.visible = playerLabelVisible(showNames, p.mini);
      a.model.setPose(p.x, p.y, p.z, p.bodyYaw);
      const f = { x: -Math.sin(p.bodyYaw), z: -Math.cos(p.bodyYaw) };
      a.anim.update(
        dt,
        {
          speed: p.speed,
          forward: p.vx * f.x + p.vz * f.z,
          right: p.vx * -f.z + p.vz * f.x,
          crouching: p.crouching,
          airborne: !p.grounded,
        },
        {
          justJumped: p.jumpSequence > a.jump,
          falling: !p.grounded,
          grounded: p.grounded,
        },
        TPP_DEFAULTS,
        1,
      );
      a.jump = p.jumpSequence;
    }
  }
  dispose() {
    this.update([], 0);
  }
}
