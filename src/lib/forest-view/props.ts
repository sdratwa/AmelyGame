import * as THREE from "three";
import type { ChestAsset } from "@/lib/assets/props";
import type { ChestPlacement } from "@/lib/game/world/chests";

/** Czas otwierania pokrywy (s): w zakresie 0,7-1,0 s z prośby autora. */
export const CHEST_OPEN_SECONDS = 0.85;
/** Skrzynie dalej niż to od gracza nie są rysowane (poza streamowanym oknem lasu nie ma pod nimi gruntu). */
export const CHEST_DRAW_DISTANCE = 110;

/**
 * Postęp otwierania 0..1 -> mnożnik kąta pełnego otwarcia: łagodne przyspieszenie, krótkie przeszarżowanie i
 * osiadanie (odbicie ok. 5%); na końcu dokładnie 1.
 */
export function openEase(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  if (x >= 1) return 1;
  const c1 = 1.1;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

type ChestSlot = {
  placement: ChestPlacement;
  base: THREE.Matrix4;
  /** Aktualny mnożnik kąta (0 zamknięta, 1 otwarta). */
  open: number;
  from: number;
  to: number;
  startedAt: number;
};

const Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * Warstwa skrzyń lasu: dwie siatki instancjonowane (korpus i pokrywy), czyli dwa wywołania rysowania dla wszystkich
 * skrzyń. Każda pokrywa ma własną macierz instancji: obrót wokół zawiasu (oś X w węźle Lid_Hinge) jest liczony
 * niezależnie, więc skrzynie otwierają się osobno. Stan otwarcia pochodzi z gry (`setOpened`), nie z tej klasy.
 */
export class ChestLayer {
  readonly group = new THREE.Group();
  readonly bodyMesh: THREE.InstancedMesh;
  readonly lidMesh: THREE.InstancedMesh;
  private readonly slots: ChestSlot[];
  private readonly hingeMatrix: THREE.Matrix4;
  private readonly scale: number;
  private visible: number[] = [];
  private viewer: { x: number; z: number } | null = null;
  private dirty = true;
  private clock = 0;

  constructor(
    private readonly asset: ChestAsset,
    placements: readonly ChestPlacement[],
    options: { castShadow: boolean; receiveShadow: boolean },
  ) {
    this.scale = asset.entry.worldScale;
    this.hingeMatrix = new THREE.Matrix4().makeTranslation(asset.hinge.x, asset.hinge.y, asset.hinge.z);
    this.slots = placements.map((placement) => ({
      placement,
      base: new THREE.Matrix4().compose(
        new THREE.Vector3(placement.x, placement.y, placement.z),
        new THREE.Quaternion().setFromAxisAngle(Y_AXIS, placement.yaw),
        new THREE.Vector3(this.scale, this.scale, this.scale),
      ),
      open: 0,
      from: 0,
      to: 0,
      startedAt: 0,
    }));
    const n = Math.max(1, placements.length);
    this.bodyMesh = new THREE.InstancedMesh(asset.body, asset.material, n);
    this.lidMesh = new THREE.InstancedMesh(asset.lid, asset.material, n);
    this.bodyMesh.name = "chests:body";
    this.lidMesh.name = "chests:lid";
    for (const mesh of [this.bodyMesh, this.lidMesh]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Są tylko 3 skrzynie, a ich obwiednia (instancje rozrzucone po lesie) nie nadaje się do odcinania: o widoczności decyduje dystans.
      mesh.frustumCulled = false;
      mesh.castShadow = options.castShadow;
      mesh.receiveShadow = options.receiveShadow;
      mesh.count = 0;
      this.group.add(mesh);
    }
    this.group.name = "chests";
  }

  get ids(): string[] {
    return this.slots.map((s) => s.placement.id);
  }

  setShadows(cast: boolean, receive: boolean): void {
    for (const mesh of [this.bodyMesh, this.lidMesh]) {
      mesh.castShadow = cast;
      mesh.receiveShadow = receive;
    }
  }

  /** Aktualny mnożnik kąta pokrywy skrzyni (0 zamknięta, 1 otwarta). */
  openness(id: string): number {
    return this.slots.find((s) => s.placement.id === id)?.open ?? 0;
  }

  isAnimating(): boolean {
    return this.slots.some((s) => s.open !== s.to);
  }

  /** Ustawia stan otwarcia wg gry; zmiana zamknięta -> otwarta animuje pokrywę, a bez `animate` ustawia ją od razu. */
  setOpened(opened: (id: string) => boolean, animate: boolean): string[] {
    const started: string[] = [];
    for (const slot of this.slots) {
      const to = opened(slot.placement.id) ? 1 : 0;
      if (to === slot.to) continue;
      slot.to = to;
      if (animate) {
        slot.from = slot.open;
        slot.startedAt = this.clock;
        if (to === 1) started.push(slot.placement.id);
      } else {
        slot.open = to;
        slot.from = to;
      }
      this.dirty = true;
    }
    return started;
  }

  /** Posuwa animacje o `dt` sekund i odświeża instancje; zwraca true, gdy macierze się zmieniły. */
  update(dt: number, viewer?: { x: number; z: number }): boolean {
    this.clock += dt;
    if (viewer) {
      const moved = !this.viewer || Math.abs(viewer.x - this.viewer.x) > 2 || Math.abs(viewer.z - this.viewer.z) > 2;
      if (moved) {
        this.viewer = { x: viewer.x, z: viewer.z };
        this.dirty = true;
      }
    }
    for (const slot of this.slots) {
      if (slot.open === slot.to) continue;
      const t = (this.clock - slot.startedAt) / (CHEST_OPEN_SECONDS * Math.abs(slot.to - slot.from));
      slot.open = t >= 1 ? slot.to : slot.from + (slot.to - slot.from) * openEase(t);
      this.dirty = true;
    }
    if (!this.dirty) return false;
    this.writeInstances();
    this.dirty = false;
    return true;
  }

  private writeInstances(): void {
    const v = this.viewer;
    this.visible = [];
    this.slots.forEach((slot, i) => {
      const p = slot.placement;
      if (!v || (p.x - v.x) ** 2 + (p.z - v.z) ** 2 <= CHEST_DRAW_DISTANCE ** 2) this.visible.push(i);
    });
    const rot = new THREE.Matrix4();
    const lid = new THREE.Matrix4();
    this.visible.forEach((slotIndex, k) => {
      const slot = this.slots[slotIndex];
      this.bodyMesh.setMatrixAt(k, slot.base);
      lid.copy(slot.base).multiply(this.hingeMatrix).multiply(rot.makeRotationX(this.asset.openAngle * slot.open));
      this.lidMesh.setMatrixAt(k, lid);
    });
    this.bodyMesh.count = this.visible.length;
    this.lidMesh.count = this.visible.length;
    this.bodyMesh.instanceMatrix.needsUpdate = true;
    this.lidMesh.instanceMatrix.needsUpdate = true;
  }

  /** Liczba rysowanych skrzyń (do diagnostyki i testów). */
  get visibleCount(): number {
    return this.bodyMesh.count;
  }

  /** Macierz pokrywy skrzyni o danym id (testy); null, gdy skrzynia nie jest rysowana. */
  lidMatrix(id: string): THREE.Matrix4 | null {
    const slotIndex = this.slots.findIndex((s) => s.placement.id === id);
    const k = this.visible.indexOf(slotIndex);
    if (k < 0) return null;
    return new THREE.Matrix4().fromArray(this.lidMesh.instanceMatrix.array as Float32Array, k * 16);
  }

  bodyMatrix(id: string): THREE.Matrix4 | null {
    const slotIndex = this.slots.findIndex((s) => s.placement.id === id);
    const k = this.visible.indexOf(slotIndex);
    if (k < 0) return null;
    return new THREE.Matrix4().fromArray(this.bodyMesh.instanceMatrix.array as Float32Array, k * 16);
  }

  dispose(): void {
    this.group.removeFromParent();
    this.bodyMesh.dispose();
    this.lidMesh.dispose();
    this.asset.dispose();
  }
}

export type BurstKind = "wood" | "stone" | "sparkle";

const BURST_PALETTE: Record<BurstKind, [number, number, number][]> = {
  wood: [
    [0.62, 0.42, 0.22],
    [0.45, 0.3, 0.16],
    [0.35, 0.55, 0.22],
  ],
  stone: [
    [0.62, 0.62, 0.64],
    [0.46, 0.47, 0.5],
    [0.74, 0.73, 0.7],
  ],
  sparkle: [
    [1, 0.86, 0.4],
    [1, 0.95, 0.7],
    [0.9, 0.7, 0.3],
  ],
};

const BURST_COUNT: Record<BurstKind, number> = { wood: 22, stone: 20, sparkle: 18 };
const BURST_LIFE: Record<BurstKind, number> = { wood: 0.7, stone: 0.65, sparkle: 1.1 };

/**
 * Krótki rozbłysk cząstek (drzazgi, odłamki kamienia, iskry skrzyni) w jednym obiekcie Points: jedno wywołanie rysowania,
 * tylko gdy jakieś cząstki żyją. Bufor kołowy (maks. 160 cząstek), symulacja na CPU.
 */
export class FxBurst {
  static readonly CAPACITY = 160;
  readonly points: THREE.Points;
  private readonly positions = new Float32Array(FxBurst.CAPACITY * 3);
  private readonly colors = new Float32Array(FxBurst.CAPACITY * 4);
  private readonly velocity = new Float32Array(FxBurst.CAPACITY * 3);
  private readonly age = new Float32Array(FxBurst.CAPACITY).fill(Infinity);
  private readonly life = new Float32Array(FxBurst.CAPACITY);
  private readonly gravity = new Float32Array(FxBurst.CAPACITY);
  private readonly base = new Float32Array(FxBurst.CAPACITY * 3);
  private next = 0;
  private alive = 0;
  private seed = 1;

  constructor() {
    const geometry = new THREE.BufferGeometry();
    const pos = new THREE.BufferAttribute(this.positions, 3);
    const col = new THREE.BufferAttribute(this.colors, 4);
    pos.setUsage(THREE.DynamicDrawUsage);
    col.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("position", pos);
    geometry.setAttribute("color", col);
    this.points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ size: 0.13, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false }),
    );
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.points.name = "fx-burst";
  }

  get aliveCount(): number {
    return this.alive;
  }

  private rand(): number {
    // Deterministyczny generator (efekt kosmetyczny, ale testy nie powinny zależeć od Math.random).
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  spawn(kind: BurstKind, x: number, y: number, z: number): void {
    const palette = BURST_PALETTE[kind];
    const n = BURST_COUNT[kind];
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % FxBurst.CAPACITY;
      const a = this.rand() * Math.PI * 2;
      const speed = kind === "sparkle" ? 0.4 + this.rand() * 0.9 : 1.2 + this.rand() * 2.2;
      this.base.set([x + (this.rand() - 0.5) * 0.4, y + (this.rand() - 0.2) * 0.4, z + (this.rand() - 0.5) * 0.4], i * 3);
      this.velocity.set([Math.cos(a) * speed, (kind === "sparkle" ? 0.9 : 1.4) + this.rand() * 1.4, Math.sin(a) * speed], i * 3);
      this.gravity[i] = kind === "sparkle" ? 0.4 : 7;
      this.age[i] = 0;
      this.life[i] = BURST_LIFE[kind] * (0.7 + this.rand() * 0.6);
      const c = palette[Math.floor(this.rand() * palette.length)];
      this.colors.set([c[0], c[1], c[2], 1], i * 4);
    }
    this.points.visible = true;
    this.alive = Math.min(FxBurst.CAPACITY, this.alive + n);
  }

  update(dt: number): void {
    if (this.alive === 0) return;
    let alive = 0;
    for (let i = 0; i < FxBurst.CAPACITY; i++) {
      const age = this.age[i];
      if (!Number.isFinite(age)) continue;
      const t = age + dt;
      if (t >= this.life[i]) {
        this.age[i] = Infinity;
        this.colors[i * 4 + 3] = 0;
        this.positions[i * 3 + 1] = -1000;
        continue;
      }
      this.age[i] = t;
      alive++;
      const g = this.gravity[i];
      this.positions[i * 3] = this.base[i * 3] + this.velocity[i * 3] * t;
      this.positions[i * 3 + 1] = this.base[i * 3 + 1] + this.velocity[i * 3 + 1] * t - 0.5 * g * t * t;
      this.positions[i * 3 + 2] = this.base[i * 3 + 2] + this.velocity[i * 3 + 2] * t;
      this.colors[i * 4 + 3] = 1 - (t / this.life[i]) ** 2;
    }
    this.alive = alive;
    this.points.visible = alive > 0;
    (this.points.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.points.removeFromParent();
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
