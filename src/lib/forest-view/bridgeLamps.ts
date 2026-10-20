import * as THREE from "three";
import type { BridgeLampPoint } from "@/lib/game/world/bridgeLayout";

/**
 * Nocne latarnie mostu. Wszystkie strojenia są w `BRIDGE_LAMP_CONFIG` (jedno miejsce do edycji): temperatura barwy,
 * jasność, zasięg, rozmiar świecącej powierzchni, liczba jednocześnie świecących źródeł i zasięg cięcia dystansowego.
 * Pozycje latarni pochodzą z geometrii modelu (`planBridge`: oś modelu, wysokość latarni nad pokładem), a poprawka
 * `offset` pozwala je dosunąć do szklanej części latarni bez zmiany układu mostu.
 */
export type BridgeLampConfig = {
  kelvin: number;
  intensity: number;
  distance: number;
  decay: number;
  maxLights: number;
  lightRange: number;
  fadeStart: number;
  glowRadius: number;
  glowRange: number;
  offset: { inward: number; up: number };
};

export const BRIDGE_LAMP_CONFIG: BridgeLampConfig = {
  /** Barwa światła (K): ciepłe, żarowe 2200-2700 K. */
  kelvin: 2400,
  /** Natężenie źródła w pełni zapalonego (jednostki fizyczne three.js, cd). */
  intensity: 22,
  /** Zasięg światła (m) i zanik fizyczny. */
  distance: 13,
  decay: 2,
  /** Liczba jednocześnie świecących PointLight (stała pula: liczba świateł w scenie się nie zmienia, więc brak przeładowania shaderów). */
  maxLights: 3,
  /** Poza tym dystansem od kamery światła nie są przydzielane; łagodne wygaszanie od `fadeStart`. */
  lightRange: 48,
  fadeStart: 34,
  /** Świecąca powierzchnia latarni (m): promień małej kulki. Widoczna tylko przy zapalonych latarniach. */
  glowRadius: 0.2,
  /** Poza tym dystansem od kamery świecące powierzchnie są ukryte (cięcie kosztu). */
  glowRange: 160,
  /** Poprawka pozycji latarni względem modelu: w poprzek mostu (do osi) i w górę (m). */
  offset: { inward: 0, up: 0 },
};

/** Godziny przejść (czas gry): zmierzch 18-21 stopniowo włącza, noc pełna, świt 5-8 stopniowo gasi, dzień wyłączone. */
export const LAMP_HOURS = { duskStart: 18, nightStart: 21, dawnStart: 5, dayStart: 8 } as const;

const smooth = (t: number): number => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

/** Poziom zapalenia latarni 0..1 dla godziny gry (0-24, cyklicznie). */
export function lampLevel(hour: number): number {
  if (!Number.isFinite(hour)) return 0;
  const h = ((hour % 24) + 24) % 24;
  const { duskStart, nightStart, dawnStart, dayStart } = LAMP_HOURS;
  if (h >= nightStart || h < dawnStart) return 1;
  if (h >= duskStart) return smooth((h - duskStart) / (nightStart - duskStart));
  if (h < dayStart) return 1 - smooth((h - dawnStart) / (dayStart - dawnStart));
  return 0;
}

/** Przybliżona barwa ciała doskonale czarnego (0-1 na kanał) dla temperatury w kelwinach (zakres 1000-6500 K). */
export function kelvinToRgb(kelvin: number): { r: number; g: number; b: number } {
  const t = Math.min(6500, Math.max(1000, kelvin)) / 100;
  const g = 99.4708025861 * Math.log(t) - 161.1195681661;
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const clamp = (v: number) => Math.min(255, Math.max(0, v)) / 255;
  return { r: 1, g: clamp(g), b: clamp(b) };
}

/** Pozycja źródła światła i świecącej powierzchni po poprawce z konfiguracji (poprawka "do środka" idzie ku osi mostu). */
export function lampWorldPosition(lamp: BridgeLampPoint, layout: { west: { x: number; z: number }; axis: { x: number; z: number }; normal: { x: number; z: number } }, cfg: BridgeLampConfig = BRIDGE_LAMP_CONFIG) {
  const inward = -lamp.side * cfg.offset.inward;
  return { x: lamp.x + layout.normal.x * inward, y: lamp.y + cfg.offset.up, z: lamp.z + layout.normal.z * inward };
}

/** Indeksy `max` najbliższych latarni w zasięgu (od najbliższej); czysta funkcja, bez alokacji świata. */
export function nearestLamps(points: readonly { x: number; z: number }[], cx: number, cz: number, max: number, range: number): { index: number; distance: number }[] {
  const out: { index: number; distance: number }[] = [];
  points.forEach((p, index) => {
    const distance = Math.hypot(p.x - cx, p.z - cz);
    if (distance <= range) out.push({ index, distance });
  });
  out.sort((a, b) => a.distance - b.distance || a.index - b.index);
  return out.slice(0, Math.max(0, max));
}

/** Współczynnik jasności źródła wg odległości: 1 do `fadeStart`, liniowo do 0 na `lightRange`. */
export function lightFade(distance: number, cfg: BridgeLampConfig = BRIDGE_LAMP_CONFIG): number {
  if (distance <= cfg.fadeStart) return 1;
  if (distance >= cfg.lightRange) return 0;
  return 1 - (distance - cfg.fadeStart) / (cfg.lightRange - cfg.fadeStart);
}

export type LampStats = { lamps: number; level: number; lights: number; markers: boolean };

/**
 * Warstwa latarni: jedna instancjonowana siatka świecących powierzchni (MeshBasicMaterial, nie "emisyjny most"),
 * stała pula bezcieniowych ciepłych PointLight na najbliższych latarniach i opcjonalne markery deweloperskie.
 * Bez bloomu. Żadnych świateł poza pulą; poza nocą intensywność wynosi 0 (liczba świateł w scenie jest stała).
 */
export class BridgeLamps {
  readonly group = new THREE.Group();
  private readonly points: { x: number; y: number; z: number }[];
  private readonly glow: THREE.InstancedMesh;
  private readonly glowMaterial: THREE.MeshBasicMaterial;
  private readonly glowGeometry: THREE.SphereGeometry;
  private readonly markers: THREE.InstancedMesh;
  private readonly markerGeometry: THREE.OctahedronGeometry;
  private readonly markerMaterial: THREE.MeshBasicMaterial;
  private readonly lights: THREE.PointLight[] = [];
  private level = 0;
  private active = 0;

  constructor(
    lamps: readonly BridgeLampPoint[],
    layout: { west: { x: number; z: number }; axis: { x: number; z: number }; normal: { x: number; z: number } },
    private readonly cfg: BridgeLampConfig = BRIDGE_LAMP_CONFIG,
  ) {
    this.points = lamps.map((l) => lampWorldPosition(l, layout, cfg));
    const color = kelvinToRgb(cfg.kelvin);
    const warm = new THREE.Color(color.r, color.g, color.b);

    this.glowGeometry = new THREE.SphereGeometry(cfg.glowRadius, 10, 8);
    this.glowMaterial = new THREE.MeshBasicMaterial({ color: warm, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
    this.glow = new THREE.InstancedMesh(this.glowGeometry, this.glowMaterial, Math.max(1, this.points.length));
    this.glow.name = "bridge-lamp-glow";
    this.glow.count = this.points.length;
    this.glow.castShadow = false;
    this.glow.receiveShadow = false;
    const m = new THREE.Matrix4();
    this.points.forEach((p, i) => this.glow.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)));
    this.glow.instanceMatrix.needsUpdate = true;
    this.glow.computeBoundingSphere();
    this.glow.visible = false;

    this.markerGeometry = new THREE.OctahedronGeometry(0.12, 0);
    this.markerMaterial = new THREE.MeshBasicMaterial({ color: 0xff2bd6, depthTest: false, toneMapped: false });
    this.markers = new THREE.InstancedMesh(this.markerGeometry, this.markerMaterial, Math.max(1, this.points.length));
    this.markers.name = "bridge-lamp-markers";
    this.markers.count = this.points.length;
    this.markers.renderOrder = 999;
    this.markers.frustumCulled = false;
    this.points.forEach((p, i) => this.markers.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)));
    this.markers.instanceMatrix.needsUpdate = true;
    this.markers.visible = false;

    for (let i = 0; i < cfg.maxLights; i++) {
      const light = new THREE.PointLight(warm, 0, cfg.distance, cfg.decay);
      light.castShadow = false;
      light.name = `bridge-lamp-light-${i}`;
      this.lights.push(light);
      this.group.add(light);
    }
    this.group.name = "bridge-lamps";
    this.group.add(this.glow, this.markers);
  }

  get count(): number {
    return this.points.length;
  }

  setMarkers(on: boolean): void {
    this.markers.visible = on;
  }

  /**
   * `level` 0..1 (z `lampLevel`, 0 także przed zbudowaniem i w trakcie animacji pojawiania) oraz pozycja kamery do
   * cięcia dystansowego.
   */
  update(level: number, cameraX: number, cameraZ: number): void {
    this.level = level;
    const cfg = this.cfg;
    const on = level > 0.002 && this.points.length > 0;
    this.glow.visible = on;
    this.glowMaterial.opacity = on ? Math.min(1, level) : 0;
    this.active = 0;
    const chosen = on ? nearestLamps(this.points, cameraX, cameraZ, cfg.maxLights, cfg.lightRange) : [];
    this.lights.forEach((light, i) => {
      const pick = chosen[i];
      if (!pick) {
        light.intensity = 0;
        return;
      }
      const p = this.points[pick.index];
      light.position.set(p.x, p.y, p.z);
      light.intensity = cfg.intensity * level * lightFade(pick.distance, cfg);
      if (light.intensity > 0) this.active++;
    });
    if (on) {
      let nearest = Infinity;
      for (const p of this.points) nearest = Math.min(nearest, Math.hypot(p.x - cameraX, p.z - cameraZ));
      this.glow.visible = nearest <= cfg.glowRange;
    }
  }

  stats(): LampStats {
    return { lamps: this.points.length, level: this.level, lights: this.active, markers: this.markers.visible };
  }

  dispose(): void {
    this.glowGeometry.dispose();
    this.glowMaterial.dispose();
    this.markerGeometry.dispose();
    this.markerMaterial.dispose();
    this.glow.dispose();
    this.markers.dispose();
    for (const l of this.lights) l.dispose();
  }
}
