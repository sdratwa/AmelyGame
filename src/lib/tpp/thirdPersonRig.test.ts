import { describe, expect, it } from "vitest";
import { BRIDGE_FLAG, forestEntryPose } from "@/lib/game/world/generators/v2";
import { authoritativeForestOf, forestWalkOf } from "@/lib/game/world/lookup";
import { ThirdPersonRig } from "./thirdPersonRig";

const SEED = 2030;

function makeRig() {
  const forest = authoritativeForestOf(SEED);
  const rig = new ThirdPersonRig(forestWalkOf(SEED), forest.terrain, forestEntryPose());
  return { forest, rig };
}

const press = (rig: ThirdPersonRig, ...codes: string[]) => codes.forEach((c) => rig.input.handleKey(c, true));
const run = (rig: ThirdPersonRig, seconds: number, fps = 60) => {
  for (let i = 0; i < seconds * fps; i++) rig.update(1 / fps);
};

describe("ThirdPersonRig: start z zapisanej pozycji (Kontynuuj)", () => {
  it("pozycja, kierunek ciała i kierunek kamery pochodzą z zapisanej pozy (yaw zapisu = yaw kamery)", () => {
    const forest = authoritativeForestOf(SEED);
    const start = { ...forestEntryPose(), yaw: 1.2 };
    const rig = new ThirdPersonRig(forestWalkOf(SEED), forest.terrain, start);
    expect(rig.controller.state.x).toBeCloseTo(start.x, 6);
    expect(rig.controller.state.z).toBeCloseTo(start.z, 6);
    expect(rig.controller.state.bodyYaw).toBeCloseTo(1.2, 6);
    expect(rig.camera.yaw).toBeCloseTo(1.2, 6);
  });
});

describe("ThirdPersonRig w prawdziwym lesie gry", () => {
  it("bieg na wschód: postać stoi na terenie, zatrzymuje ją rzeka (bez mostu nie ma przejścia)", () => {
    const { forest, rig } = makeRig();
    press(rig, "KeyW", "ShiftLeft");
    run(rig, 60);
    const s = rig.controller.state;
    const river = forest.geometry.riverAt(s.z);
    expect(s.x).toBeLessThan(river.x);
    expect(s.grounded).toBe(true);
    expect(Math.abs(s.y - forest.terrain.height(s.x, s.z))).toBeLessThan(0.3);
    expect(Number.isFinite(s.x) && Number.isFinite(s.z)).toBe(true);
  }, 60_000);

  it("pokład mostu podnosi stopy powyżej terenu, a kapsuła zostaje na nim", () => {
    const { forest, rig } = makeRig();
    const base = forest.terrain.height(rig.controller.state.x, rig.controller.state.z);
    rig.deckHeight = () => base + 2;
    run(rig, 2);
    expect(rig.controller.state.y).toBeGreaterThan(base + 1.9);
    expect(rig.controller.state.grounded).toBe(true);
  }, 60_000);

  it("flagi świata są przekazywane do kolizji (most otwiera przejście przez rzekę)", () => {
    const { forest, rig } = makeRig();
    const west = forest.features.poi("poi.bridge_landing_west")!;
    const east = forest.features.poi("poi.bridge_landing_east")!;
    rig.teleport(west.x, west.z, Math.atan2(-(east.x - west.x), -(east.z - west.z)));
    rig.flags = { has: (f: string) => f === BRIDGE_FLAG };
    press(rig, "KeyW", "ShiftLeft");
    run(rig, 10);
    expect(rig.controller.state.x).toBeGreaterThan(forest.geometry.riverAt(rig.controller.state.z).x - 1);
  }, 60_000);

  it("kamera skraca dystans, gdy za plecami stoi drzewo, i nie zależy od FPS gracza", () => {
    const { forest, rig } = makeRig();
    const tree = forest
      .allSectors()
      .flatMap((s) => s.colliders)
      .find((o) => o.kind === "tree" && o.collider?.shape === "circle")!;
    expect(tree).toBeTruthy();
    rig.teleport(tree.x + 1.5, tree.z, -Math.PI / 2);
    run(rig, 3);
    expect(rig.camera.distance).toBeLessThan(2);
    const p = rig.cameraPose;
    expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
  }, 60_000);

  it("skok z Spacji i kucanie z C przechodzą przez wejście; snapshot zawiera dane diagnostyczne", () => {
    const { rig } = makeRig();
    rig.input.handleKey("Space", true);
    rig.update(1 / 60);
    expect(rig.controller.state.justJumped).toBe(true);
    expect(rig.animIntent().airborne).toBe(true);
    run(rig, 1);
    rig.input.handleKey("Space", false);
    rig.input.handleKey("KeyC", true);
    run(rig, 0.5);
    const snap = rig.snapshot();
    expect(snap.crouching).toBe(true);
    expect(snap.grounded).toBe(true);
    expect(snap.cameraDistance).toBeGreaterThan(0.5);
    expect(snap.bodyYawDeg).toBeGreaterThanOrEqual(-180);
    expect(snap.bodyYawDeg).toBeLessThanOrEqual(180);
  }, 60_000);

  it("setConfig zmienia prędkość na żywo i odrzuca wartości spoza zakresu", () => {
    const { rig } = makeRig();
    rig.setConfig({ walkSpeed: 3, runSpeed: Number.NaN });
    expect(rig.config.walkSpeed).toBe(3);
    expect(Number.isFinite(rig.config.runSpeed)).toBe(true);
    rig.setConfig({ walkSpeed: 999 });
    expect(rig.config.walkSpeed).toBeLessThanOrEqual(5);
  }, 60_000);
});

describe("ThirdPersonRig: bramka ruchu zabawy w chowanego", () => {
  const frozen = { anchor: { x: 0, z: 0 }, allowJump: false, allowCrouch: false, allowLook: false, cameraDown: true };

  it("zamrożony szukający: ruch, bieg, skok, kucanie i obrót kamery nie działają, kamera patrzy w dół", () => {
    const { rig } = makeRig();
    const start = { x: rig.controller.state.x, z: rig.controller.state.z };
    rig.setGate({ ...frozen, anchor: start });
    const yaw = rig.camera.yaw;
    press(rig, "KeyW", "ShiftLeft", "Space", "KeyC");
    rig.input.look(300, 200);
    run(rig, 3);
    const s = rig.controller.state;
    expect(s.x).toBeCloseTo(start.x, 6);
    expect(s.z).toBeCloseTo(start.z, 6);
    expect(s.crouching).toBe(false);
    expect(s.grounded).toBe(true);
    expect(rig.camera.yaw).toBeCloseTo(yaw, 6);
    expect(rig.cameraPose.pitch).toBeLessThan(-1.5);
  });

  it("zablokowany ukrywający się: stoi w miejscu, ale skacze, kuca i obraca kamerę; po zdjęciu bramki znów chodzi", () => {
    const { rig } = makeRig();
    const start = { x: rig.controller.state.x, z: rig.controller.state.z };
    rig.setGate({ anchor: start, allowJump: true, allowCrouch: true, allowLook: true, cameraDown: false });
    press(rig, "KeyW");
    rig.input.look(200, 0);
    let airborne = false;
    rig.input.handleKey("Space", true);
    for (let i = 0; i < 90; i++) {
      rig.update(1 / 60);
      if (!rig.controller.state.grounded) airborne = true;
    }
    expect(airborne).toBe(true);
    expect(rig.controller.state.x).toBeCloseTo(start.x, 6);
    expect(rig.controller.state.z).toBeCloseTo(start.z, 6);
    expect(rig.camera.yaw).not.toBeCloseTo(0, 3);
    rig.input.handleKey("Space", false);
    rig.input.handleKey("KeyC", true);
    rig.update(1 / 60);
    expect(rig.controller.state.crouching).toBe(true);
    rig.input.handleKey("KeyC", false);
    rig.setGate({ anchor: null, allowJump: true, allowCrouch: true, allowLook: true, cameraDown: false });
    rig.input.handleKey("KeyC", true);
    rig.input.handleKey("KeyC", false);
    run(rig, 2);
    expect(Math.hypot(rig.controller.state.x - start.x, rig.controller.state.z - start.z)).toBeGreaterThan(0.5);
  });

  it("korekta z serwera przenosi postać w poziomie i zeruje prędkość", () => {
    const { rig } = makeRig();
    press(rig, "KeyW");
    run(rig, 1);
    rig.snapHorizontal(5, 6);
    expect(rig.controller.state.x).toBe(5);
    expect(rig.controller.state.z).toBe(6);
    expect(rig.controller.state.speed).toBe(0);
  });
});
