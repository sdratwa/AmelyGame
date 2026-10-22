import type { TppConfig } from "./config";

export type CameraWorld = {
  /** Wysokość powierzchni pod punktem (teren albo pokład mostu). */
  groundAt(x: number, z: number): number;
  /**
   * Wysokość nad podłożem, do której przeszkoda w punkcie (x, z) zasłania kamerę o promieniu `r`; 0 = brak przeszkody.
   * Drzewa zasłaniają na całej wysokości, skały i drobne obiekty tylko do swojej wysokości.
   */
  obstacleTop(x: number, z: number, r: number): number;
};

export type CameraPose = { x: number; y: number; z: number; yaw: number; pitch: number };

const SAMPLES = 14;
const RADIUS = 0.18;
const DEG = Math.PI / 180;

const blend = (dt: number, tau: number) => (tau <= 1e-6 ? 1 : 1 - Math.exp(-dt / tau));
const wrapPi = (a: number) => {
  let d = a % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

/**
 * Kamera trzecioosobowa: orbita (yaw, pitch) wokół punktu na tułowiu postaci. Translacja i rotacja są wygładzane osobno
 * (stałe czasowe w sekundach, niezależne od FPS). Kamera nie schodzi pod teren, a przeszkoda między postacią i kamerą
 * skraca dystans (natychmiast), po czym kamera płynnie wraca na zadaną odległość. Wynik: `pose` (pozycja i kąty jak
 * w `FirstPersonController`: yaw w lewo, pitch ujemny = patrzenie w dół).
 */
export class ThirdPersonCamera {
  /** Kąty zadane przez gracza (bez wygładzania). */
  yaw: number;
  pitch: number;
  /** Kąty po wygładzeniu (te idą do kamery). */
  private shownYaw: number;
  private shownPitch: number;
  private px = 0;
  private py = 0;
  private pz = 0;
  private started = false;
  /** Aktualny dystans po kolizjach (m). */
  distance: number;
  readonly pose: CameraPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };

  constructor(
    private readonly world: CameraWorld,
    public config: TppConfig,
    yaw: number,
  ) {
    this.yaw = yaw;
    this.shownYaw = yaw;
    this.pitch = -config.cameraPitchDeg * DEG;
    this.shownPitch = this.pitch;
    this.distance = config.cameraDistance;
  }

  /** Kąt patrzenia (ujemny = w dół) ograniczony wysokością kamery nad celem: min i max z konfiguracji to kąty elewacji kamery. */
  clampPitch(pitch: number): number {
    const c = this.config;
    return Math.max(-c.cameraMaxPitchDeg * DEG, Math.min(-c.cameraMinPitchDeg * DEG, pitch));
  }

  /** Obrót kamery ruchem myszy (piksele); pitch ograniczony zakresem z konfiguracji. */
  look(dx: number, dy: number): void {
    const c = this.config;
    this.yaw -= dx * c.cameraSensitivity;
    this.pitch = this.clampPitch(this.pitch - dy * c.cameraSensitivity);
  }

  /** Obrót analogowy (pad), rad/s. */
  lookAnalog(x: number, y: number, dt: number, yawRate: number, pitchRate: number): void {
    const step = Math.min(Math.max(dt, 0), 0.1);
    this.yaw -= x * yawRate * step;
    this.pitch = this.clampPitch(this.pitch - y * pitchRate * step);
  }

  /** Natychmiastowe ustawienie na postaci (start, teleport): bez opóźnienia kamery. */
  snap(): void {
    this.started = false;
    this.shownYaw = this.yaw;
    this.shownPitch = this.pitch;
  }

  /**
   * `target`: punkt, na który patrzy kamera (tułów postaci). `dt` w sekundach (obcinane do 0,1 s).
   * Zwraca `pose` (obiekt współdzielony, bez alokacji w klatce).
   */
  update(dt: number, target: { x: number; y: number; z: number }): CameraPose {
    const c = this.config;
    const step = Math.min(Math.max(dt, 0), 0.1);
    if (!this.started) {
      this.px = target.x;
      this.py = target.y;
      this.pz = target.z;
      this.started = true;
    } else {
      const k = blend(step, c.cameraSmoothness);
      this.px += (target.x - this.px) * k;
      this.py += (target.y - this.py) * k;
      this.pz += (target.z - this.pz) * k;
    }
    const kr = blend(step, c.cameraRotationSmoothness);
    this.shownYaw += wrapPi(this.yaw - this.shownYaw) * kr;
    this.shownPitch += (this.pitch - this.shownPitch) * kr;

    const yaw = this.shownYaw;
    const pitch = this.shownPitch;
    const cp = Math.cos(pitch);
    // Kierunek patrzenia i wektor w prawo (poziomy).
    const dx = -Math.sin(yaw) * cp;
    const dy = Math.sin(pitch);
    const dz = -Math.cos(yaw) * cp;
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const ox = this.px + rx * c.cameraShoulder;
    const oz = this.pz + rz * c.cameraShoulder;
    const free = this.freeDistance(ox, this.py, oz, dx, dy, dz, c.cameraDistance);
    if (free < this.distance) this.distance = free;
    else this.distance += (free - this.distance) * blend(step, 0.25);

    const p = this.pose;
    p.x = ox - dx * this.distance;
    p.y = this.py - dy * this.distance;
    p.z = oz - dz * this.distance;
    const floor = this.world.groundAt(p.x, p.z) + c.cameraMargin;
    if (p.y < floor) p.y = floor;
    p.yaw = yaw;
    p.pitch = pitch;
    return p;
  }

  /** Największa odległość od celu wzdłuż promienia wstecz, na której kamera nie jest pod terenem ani w przeszkodzie. */
  private freeDistance(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, wanted: number): number {
    const c = this.config;
    let free = wanted;
    for (let i = 1; i <= SAMPLES; i++) {
      const t = (i / SAMPLES) * wanted;
      const x = ox - dx * t;
      const y = oy - dy * t;
      const z = oz - dz * t;
      const ground = this.world.groundAt(x, z);
      const top = this.world.obstacleTop(x, z, RADIUS);
      const blocked = y < ground + c.cameraMargin * 0.6 || (top > 0 && y < ground + top + c.cameraMargin * 0.5);
      if (blocked) {
        free = ((i - 1) / SAMPLES) * wanted - c.cameraMargin * 0.5;
        break;
      }
    }
    return Math.max(c.cameraMinDistance, free);
  }
}
