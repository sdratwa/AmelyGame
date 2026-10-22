import * as THREE from "three";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { type PlayerAsset, sceneNodeName } from "../assets/characters";
import { PlayerModel } from "./playerModel";
import { PlayerAnimator } from "./playerAnimator";
import { TPP_DEFAULTS } from "../tpp/config";
import type { Player } from "../multiplayer/protocol";
export class RemotePlayers {
  private actors = new Map<
    string,
    {
      model: PlayerModel;
      anim: PlayerAnimator;
      jump: number;
      label: THREE.Sprite;
    }
  >();
  constructor(
    private scene: THREE.Scene,
    private template: PlayerAsset,
  ) {}
  update(players: Player[], dt: number) {
    for (const [id, a] of this.actors)
      if (!players.some((p) => p.playerId === id)) {
        a.anim.dispose();
        a.model.group.removeFromParent();
        const skeletons = new Set<THREE.Skeleton>();
        a.model.asset.scene.traverse((node) => {
          if ((node as THREE.SkinnedMesh).isSkinnedMesh)
            skeletons.add((node as THREE.SkinnedMesh).skeleton);
        });
        for (const skeleton of skeletons) skeleton.dispose();
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
        a = { model, anim, jump: p.jumpSequence, label };
        this.actors.set(p.playerId, a);
      }
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
