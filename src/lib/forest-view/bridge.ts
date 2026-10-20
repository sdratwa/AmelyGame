import * as THREE from "three";
import type { BridgeAsset } from "@/lib/assets/bridge";
import type { BridgeLayout } from "@/lib/game/world/bridgeLayout";
import { BridgeLamps, lampLevel, type LampStats } from "./bridgeLamps";
import { assembleBridge, sliceBridgeSources, triangleCountOf } from "./bridgeModules";

/** Czas pojawiania się mostu (s): krótki, łagodny wzrost z gruntu; wczytany zapis pokazuje most od razu. */
export const BRIDGE_RISE_SECONDS = 1.2;
/** O ile (m) niżej zaczyna się wzrost; poniżej gruntu i lustra wody, więc nie widać wyrastania w powietrzu. */
export const BRIDGE_RISE_DEPTH = 2.6;

/** Łagodne wyhamowanie (ease-out cubic). */
export const riseEase = (t: number): number => {
  const x = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - x, 3);
};

/**
 * Warstwa mostu: jedna siatka (przyczółki + powielone segmenty + segmenty z latarniami, złożone wg `BridgeLayout`)
 * z materiałem z GLB. Niewidoczna do zbudowania mostu. Siatka nie rzuca dynamicznych cieni; kolizje i przejście
 * przez rzekę są w świecie gry (`passage.bridge` + poręcze z `syncBridgeColliders`), a nie w tej geometrii.
 */
export class BridgeLayer {
  readonly group = new THREE.Group();
  readonly mesh: THREE.Mesh;
  readonly triangles: number;
  private readonly geometry: THREE.BufferGeometry;
  private built = false;
  private rise = 1;
  private rising = false;
  private hour = 12;
  readonly lamps: BridgeLamps;

  constructor(
    private readonly asset: BridgeAsset,
    readonly layout: BridgeLayout,
    options: { receiveShadow: boolean },
  ) {
    const merged = assembleBridge(sliceBridgeSources(asset.source), layout);
    this.triangles = triangleCountOf(merged);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(merged.positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(merged.normals, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(merged.uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(merged.indices, 1));
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    this.geometry = geometry;
    this.mesh = new THREE.Mesh(geometry, asset.material);
    this.mesh.name = "bridge";
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = options.receiveShadow;
    this.mesh.matrixAutoUpdate = false;
    this.group.name = "bridge-layer";
    this.group.add(this.mesh);
    this.lamps = new BridgeLamps(layout.lamps, layout);
    this.group.add(this.lamps.group);
    this.group.visible = false;
  }

  get isBuilt(): boolean {
    return this.built;
  }

  /** Postęp pojawiania 0..1 (1 = stoi w pełni); latarnie zapalają się dopiero po zakończeniu. */
  get progress(): number {
    return this.built ? this.rise : 0;
  }

  get isRising(): boolean {
    return this.rising;
  }

  setShadows(receive: boolean): void {
    this.mesh.receiveShadow = receive;
  }

  /** Ustawia stan wg gry; `animate` tylko dla przejścia "niezbudowany -> zbudowany" w trakcie sesji. */
  setBuilt(built: boolean, animate: boolean): void {
    if (built === this.built) return;
    this.built = built;
    this.group.visible = built;
    if (built && animate) {
      this.rise = 0;
      this.rising = true;
    } else {
      this.rise = 1;
      this.rising = false;
    }
    this.applyRise();
  }

  /** Godzina gry (0-24): steruje latarniami (zmierzch 18-21 włącza, świt 5-8 gasi). */
  setHour(hour: number): void {
    this.hour = hour;
  }

  /** Jasność latarni teraz: 0 przed zbudowaniem i w trakcie pojawiania się mostu. */
  get lampLevel(): number {
    return this.built && !this.rising ? lampLevel(this.hour) : 0;
  }

  lampStats(): LampStats {
    return this.lamps.stats();
  }

  update(dt: number, cameraX = 0, cameraZ = 0): void {
    if (this.rising) {
      this.rise = Math.min(1, this.rise + dt / BRIDGE_RISE_SECONDS);
      if (this.rise >= 1) this.rising = false;
      this.applyRise();
    }
    if (this.built) this.lamps.update(this.lampLevel, cameraX, cameraZ);
  }

  private applyRise(): void {
    const lift = -(1 - riseEase(this.rise)) * BRIDGE_RISE_DEPTH;
    this.mesh.matrix.makeTranslation(0, lift, 0);
    this.mesh.matrixWorldNeedsUpdate = true;
    this.mesh.updateMatrixWorld(true);
  }

  dispose(): void {
    this.lamps.dispose();
    this.geometry.dispose();
    this.asset.dispose();
  }
}
