import { describe, expect, it } from "vitest";
import { ThirdPersonCamera, type CameraWorld } from "./cameraRig";
import { TPP_DEFAULTS, TPP_RANGES } from "./config";

const open: CameraWorld = { groundAt: () => 0, obstacleTop: () => 0 };
const target = { x: 0, y: 1.25, z: 0 };
const settle = (cam: ThirdPersonCamera, t = target, seconds = 2, fps = 60) => {
  for (let i = 0; i < seconds * fps; i++) cam.update(1 / fps, t);
};

describe("ThirdPersonCamera: ustawienie", () => {
  it("kamera stoi za postacią (yaw 0 = patrzy w -Z, więc kamera jest na +Z), wyżej i patrzy w dół o zadany kąt", () => {
    const cam = new ThirdPersonCamera(open, { ...TPP_DEFAULTS, cameraShoulder: 0 }, 0);
    settle(cam);
    const p = cam.pose;
    expect(p.z).toBeGreaterThan(2);
    expect(p.y).toBeGreaterThan(target.y);
    expect(p.pitch).toBeCloseTo((-TPP_DEFAULTS.cameraPitchDeg * Math.PI) / 180, 4);
    expect(Math.hypot(p.x - target.x, p.y - target.y, p.z - target.z)).toBeCloseTo(TPP_DEFAULTS.cameraDistance, 2);
  });

  it("domyślny dystans mieści się w zakresie suwaka, a kąt to 10-20° w dół", () => {
    expect(TPP_DEFAULTS.cameraDistance).toBeGreaterThanOrEqual(TPP_RANGES.cameraDistance!.min);
    expect(TPP_DEFAULTS.cameraDistance).toBeLessThanOrEqual(TPP_RANGES.cameraDistance!.max);
    expect(TPP_DEFAULTS.cameraPitchDeg).toBeGreaterThanOrEqual(10);
    expect(TPP_DEFAULTS.cameraPitchDeg).toBeLessThanOrEqual(20);
  });

  it("obrót myszą zmienia yaw i pitch, a pitch jest ograniczony z obu stron", () => {
    const cam = new ThirdPersonCamera(open, TPP_DEFAULTS, 0);
    cam.look(100, 0);
    expect(cam.yaw).toBeCloseTo(-100 * TPP_DEFAULTS.cameraSensitivity, 6);
    cam.look(0, 1e6);
    expect(cam.pitch).toBeCloseTo((-TPP_DEFAULTS.cameraMaxPitchDeg * Math.PI) / 180, 6);
    cam.look(0, -1e6);
    expect(cam.pitch).toBeCloseTo((-TPP_DEFAULTS.cameraMinPitchDeg * Math.PI) / 180, 6);
  });
});

describe("ThirdPersonCamera: wygładzanie", () => {
  it("kamera dogania cel płynnie (opóźnienie), a pozycja po tym samym czasie nie zależy od FPS", () => {
    const far = { x: 10, y: 1.25, z: 0 };
    const a = new ThirdPersonCamera(open, TPP_DEFAULTS, 0);
    settle(a);
    a.update(1 / 60, far);
    expect(a.pose.x).toBeGreaterThan(0);
    expect(a.pose.x).toBeLessThan(10);
    const at = (fps: number) => {
      const c = new ThirdPersonCamera(open, TPP_DEFAULTS, 0);
      settle(c, target, 1, fps);
      for (let i = 0; i < 0.2 * fps; i++) c.update(1 / fps, far);
      return c.pose.x;
    };
    expect(Math.abs(at(30) - at(144))).toBeLessThan(0.15);
  });

  it("snap ustawia kamerę natychmiast na nowym celu", () => {
    const cam = new ThirdPersonCamera(open, TPP_DEFAULTS, 0);
    settle(cam);
    cam.snap();
    cam.update(1 / 60, { x: 50, y: 1.25, z: 50 });
    expect(cam.pose.x).toBeCloseTo(50 + TPP_DEFAULTS.cameraShoulder, 1);
  });
});

describe("ThirdPersonCamera: kolizje", () => {
  it("przeszkoda za plecami skraca dystans, a po jej zniknięciu kamera płynnie wraca", () => {
    let wall = true;
    const world: CameraWorld = { groundAt: () => 0, obstacleTop: (_x, z) => (wall && z > 2 ? 99 : 0) };
    const cam = new ThirdPersonCamera(world, { ...TPP_DEFAULTS, cameraShoulder: 0 }, 0);
    settle(cam);
    expect(cam.distance).toBeLessThan(2.5);
    expect(cam.distance).toBeGreaterThanOrEqual(TPP_DEFAULTS.cameraMinDistance);
    wall = false;
    cam.update(1 / 60, target);
    expect(cam.distance).toBeLessThan(TPP_DEFAULTS.cameraDistance);
    settle(cam);
    expect(cam.distance).toBeCloseTo(TPP_DEFAULTS.cameraDistance, 1);
  });

  it("kamera nie schodzi pod teren (wzgórze za plecami) i trzyma zapas", () => {
    const world: CameraWorld = { groundAt: (_x, z) => (z > 1.5 ? 3 : 0), obstacleTop: () => 0 };
    const cam = new ThirdPersonCamera(world, { ...TPP_DEFAULTS, cameraShoulder: 0 }, 0);
    settle(cam);
    const g = world.groundAt(cam.pose.x, cam.pose.z);
    expect(cam.pose.y).toBeGreaterThanOrEqual(g + TPP_DEFAULTS.cameraMargin - 1e-6);
  });

  it("pose jest obiektem współdzielonym (brak alokacji w klatce)", () => {
    const cam = new ThirdPersonCamera(open, TPP_DEFAULTS, 0);
    expect(cam.update(1 / 60, target)).toBe(cam.update(1 / 60, target));
  });
});
