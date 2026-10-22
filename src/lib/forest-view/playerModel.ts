import * as THREE from "three";
import { disposeScene, sceneNodeName, type PlayerAsset } from "@/lib/assets/characters";

/**
 * Model gracza (GLB) jako dziecko logicznego obiektu: `group` stoi w punkcie stóp kapsuły i obraca się o `bodyYaw`,
 * a wewnętrzny `holder` niesie jednostajną skalę do wysokości docelowej i korektę przodu modelu. Skalowanie dotyczy
 * całego drzewa (nie pojedynczych kości), więc skinning się nie psuje. Przód modelu to +Z (manifest), a konwencja
 * kamery to -Z przy yaw = 0, stąd stały obrót o pi.
 */
export class PlayerModel {
  readonly group = new THREE.Group();
  private readonly holder = new THREE.Group();
  readonly hipsName: string;
  private modelYaw: number;

  constructor(
    readonly asset: PlayerAsset,
    options: { castShadow: boolean; receiveShadow: boolean; targetHeight?: number; modelYawDeg?: number },
  ) {
    const { entry, scene, skinned } = asset;
    const scale = (options.targetHeight ?? entry.targetHeight) / entry.sourceHeight;
    this.hipsName = sceneNodeName(entry.hipsBone);
    this.group.name = "player";
    this.holder.name = "player-model";
    this.holder.scale.setScalar(scale);
    // Stopy na podłożu: dolna krawędź siatki w pozie wiązania.
    this.holder.position.y = -entry.sourceBounds.min[1] * scale;
    this.modelYaw = ((options.modelYawDeg ?? 0) * Math.PI) / 180;
    this.holder.rotation.y = Math.PI + this.modelYaw;
    this.holder.add(scene);
    this.group.add(this.holder);
    // Ramiona i nogi wychodzą poza obwiednię z pozy wiązania, więc siatki skórowanej nie przycinamy.
    skinned.frustumCulled = false;
    this.setShadows(options.castShadow, options.receiveShadow);
  }

  get scale(): number {
    return this.holder.scale.x;
  }

  setShadows(cast: boolean, receive: boolean): void {
    this.asset.skinned.castShadow = cast;
    this.asset.skinned.receiveShadow = receive;
  }

  setModelYawDeg(deg: number): void {
    this.modelYaw = (deg * Math.PI) / 180;
    this.holder.rotation.y = Math.PI + this.modelYaw;
  }

  /** Ustawia logiczny obiekt gracza: pozycja stóp i kierunek ciała (konwencja `forwardOfYaw`). */
  setPose(x: number, y: number, z: number, bodyYaw: number): void {
    this.group.position.set(x, y, z);
    this.group.rotation.y = bodyYaw;
  }

  dispose(): void {
    this.group.removeFromParent();
    disposeScene(this.asset.scene);
  }
}
