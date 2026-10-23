import { describe, expect, it } from "vitest";
import { harvestOf } from "./harvest";
import { authoritativeForestOf, forestObject, forestOf, forestWalkOf, syncHarvestedColliders } from "./lookup";
import { makeObject, type WorldObject } from "./objects";
import { CURRENT_GEN_VERSION, fingerprintWorld, generateWorld } from "./registry";
import { buildRockProfile, ROCK_PHYSICS, ROCK_SHAPES_V1, rockPhysicsDigest, rockShapeKey, rockSurfaceY, rockWallTop } from "./rockPhysics";
import { createInstance } from "@/lib/multiplayer/world";
import { TPP_DEFAULTS } from "@/lib/tpp/config";
import { idleIntent, makeControllerAt, rockWorld } from "@/lib/tpp/testkit";

const V5 = { seed: 2030, genVersion: 5 };
const rocksOf = (ref: { seed: number; genVersion: number }) => authoritativeForestOf(ref).allSectors().flatMap((s) => s.objects).filter((o) => o.kind === "rock");

describe("profil kolizji skały (fizyka skał v1)", () => {
  const input = { kind: "rock", variant: "medium.1", scaleXYZ: [1, 0.5, 1] as const, yaw: 0, tilt: [0, 0] as const, collider: { shape: "circle", r: 1.2 } as const };

  it("jest deterministyczny, zaokrąglony do 1 mm i zależy od skali, a nie od załadowanego modelu", () => {
    const a = buildRockProfile(input)!;
    expect(buildRockProfile(input)).toEqual(a);
    expect(Math.abs(a.height - (ROCK_SHAPES_V1["rock.medium.1"].plane.y - ROCK_PHYSICS.sink) * 0.5)).toBeLessThanOrEqual(0.001);
    expect(a.wall).toBeGreaterThan(a.height);
    for (const v of [a.height, a.topRadius, ...a.topOffset]) expect(Math.round(v * 1000) / 1000).toBe(v);
    const taller = buildRockProfile({ ...input, scaleXYZ: [1, 1, 1] })!;
    expect(taller.height).toBeGreaterThan(a.height * 1.9);
  });

  it("warianty pustynne mają bryłę zwykłych, a nieznane modele i nie-skały nie dostają profilu", () => {
    expect(rockShapeKey({ kind: "rock", variant: "medium.1.desert" })).toBe("rock.medium.1");
    expect(buildRockProfile({ ...input, variant: "medium.1.desert" })).toEqual(buildRockProfile(input));
    expect(buildRockProfile({ ...input, variant: "nieznany.9" })).toBeNull();
    expect(buildRockProfile({ ...input, kind: "tree" })).toBeNull();
  });

  it("zbyt wąski albo zbyt stromy wierzch nie jest podłożem, a skała ma wtedy skończoną wysokość", () => {
    const small = buildRockProfile({ ...input, scaleXYZ: [0.15, 0.15, 0.15], collider: { shape: "circle", r: 0.2 } })!;
    expect(small).toMatchObject({ standable: false, topRadius: 0 });
    expect(small.height).toBeGreaterThan(0);
    const steep = buildRockProfile({ ...input, tilt: [0.8, 0] })!;
    expect(steep.standable).toBe(false);
  });

  it("zamrożone stałe i tabela: zmiana wartości wymaga nowej wersji generatora (odcisk jest przypięty)", () => {
    expect(Object.isFrozen(ROCK_PHYSICS)).toBe(true);
    expect(Object.isFrozen(ROCK_SHAPES_V1)).toBe(true);
    expect(rockPhysicsDigest()).toBe("fp1:02951a682b7440");
  });

  it("tolerancje fizyczne są w nazwanej konfiguracji, a parametry skoku TPP pozostają domyślne", () => {
    expect(ROCK_PHYSICS).toMatchObject({ version: 1, clearance: 0.05, landingEpsilon: 0.03, minSupportRadius: 0.15, maxStandSlopeDeg: 30, stepUp: 0.12 });
    expect(TPP_DEFAULTS).toMatchObject({ jumpHeight: 1.5, gravity: 12, airControl: 0.35, standHeight: 1.55, crouchHeight: 1.0 });
  });
});

describe("generator świata v5: fizyka skał w wersjonowanym świecie", () => {
  it("v5 jest bieżącą wersją, a jego odcisk różni się od v4 i jest deterministyczny", () => {
    expect(CURRENT_GEN_VERSION).toBe(5);
    expect(fingerprintWorld(generateWorld(2030, 5))).not.toBe(fingerprintWorld(generateWorld(2030, 4)));
    expect(fingerprintWorld(generateWorld(2030, 5))).toBe(fingerprintWorld(generateWorld(2030, 5)));
    expect(fingerprintWorld(generateWorld(2030, 5))).toBe("fp1:1535b8828a50da");
  });

  it("starsze wersje (v2-v4) nie mają profili skał i zachowują dotychczasowe zasady (skała = nieskończona ściana)", () => {
    for (const genVersion of [2, 3, 4]) {
      const rocks = rocksOf({ seed: 2030, genVersion });
      expect(rocks.length).toBeGreaterThan(100);
      expect(rocks.every((o) => o.rock === undefined), `v${genVersion}`).toBe(true);
    }
    expect(fingerprintWorld(generateWorld(2030, 4))).toBe("fp1:1ecbc439e732f5");
  });

  it("v5 nie zmienia rozmieszczenia: te same ID, pozycje, kolizje i skale co v4, tylko z profilem", () => {
    const strip = (o: WorldObject) => {
      const { rock: _rock, ...rest } = o;
      void _rock;
      return rest;
    };
    for (const seed of [2030, 7]) {
      const a = authoritativeForestOf({ seed, genVersion: 4 }).allSectors().flatMap((s) => s.objects);
      const b = authoritativeForestOf({ seed, genVersion: 5 }).allSectors().flatMap((s) => s.objects);
      expect(b.map(strip)).toEqual(a.map(strip));
      expect(b.filter((o) => o.rock).every((o) => o.kind === "rock")).toBe(true);
    }
  }, 120_000);

  it("każda skała w v5 ma profil, a rozkład wysokości zawiera niskie (do przeskoczenia) i wysokie (nie do wejścia) skały", () => {
    const rocks = rocksOf(V5);
    expect(rocks.every((o) => o.rock && o.rock.height > 0)).toBe(true);
    const heights = rocks.map((o) => o.rock!.height);
    expect(Math.min(...heights)).toBeLessThan(0.7);
    expect(Math.max(...heights)).toBeGreaterThan(TPP_DEFAULTS.jumpHeight + 1);
    expect(rocks.some((o) => o.rock!.standable && o.rock!.height > 0.9 && o.rock!.height < 1.25)).toBe(true);
    for (const o of rocks.filter((r) => r.rock!.standable)) {
      expect(o.rock!.topRadius).toBeGreaterThanOrEqual(ROCK_PHYSICS.minSupportRadius);
      // wierzch w obrysie kolizji
      const d = Math.hypot(o.rock!.topOffset[0], o.rock!.topOffset[1]);
      expect(d + o.rock!.topRadius).toBeLessThanOrEqual(o.collider!.shape === "circle" ? o.collider!.r : 0);
    }
  });

  it("pełny las (render) i las autorytatywny (serwer) mają identyczne profile skał", () => {
    const client = forestOf(V5).allSectors().flatMap((s) => s.colliders).filter((o) => o.kind === "rock");
    const server = authoritativeForestOf(V5).allSectors().flatMap((s) => s.colliders).filter((o) => o.kind === "rock");
    expect(client.length).toBeGreaterThan(0);
    expect(client).toEqual(server);
  });

  it("serwer i klient widzą te same wysokości; instancje świata nie dzielą stanu kolizji", () => {
    const a = createInstance("rock-a");
    const b = createInstance("rock-b");
    const forest = rocksOf(V5);
    for (const rock of forest.slice(0, 40)) {
      expect(a.walk.index.get(rock.id)?.rock).toEqual(rock.rock);
      expect(a.walk.index.get(rock.id)?.rock).not.toBe(b.walk.index.get(rock.id)?.rock);
    }
    const target = forest.find((o) => o.rock!.standable)!;
    const cx = target.x + target.rock!.topOffset[0];
    const cz = target.z + target.rock!.topOffset[1];
    expect(a.walk.supportSurfaceAt(cx, cz, rockSurfaceY(target, cx, cz))?.id).toBe(target.id);
    expect(a.walk.removeObject(target.id)).toBe(true);
    expect(a.walk.supportSurfaceAt(cx, cz, rockSurfaceY(target, cx, cz))).toBeNull();
    expect(b.walk.supportSurfaceAt(cx, cz, rockSurfaceY(target, cx, cz))?.id).toBe(target.id);
  });

  it("pozyskanie skały usuwa jej collider i powierzchnię stania, a cofnięcie ją przywraca", () => {
    const target = rocksOf(V5).find((o) => o.rock!.standable && harvestOf(o))!;
    const walk = forestWalkOf(V5);
    const cx = target.x + target.rock!.topOffset[0];
    const cz = target.z + target.rock!.topOffset[1];
    const y = rockSurfaceY(target, cx, cz);
    expect(forestObject(V5, target.id)?.rock).toEqual(target.rock);
    expect(walk.supportSurfaceAt(cx, cz, y)?.id).toBe(target.id);
    syncHarvestedColliders(V5, [target.id]);
    try {
      expect(walk.supportSurfaceAt(cx, cz, y)).toBeNull();
      expect(walk.rocksNear(target.x, target.z, 0.5)).toBe(false);
    } finally {
      syncHarvestedColliders(V5, []);
    }
    expect(walk.supportSurfaceAt(cx, cz, y)?.id).toBe(target.id);
  });

  const CLASSES = [
    { name: "mała 0,45-0,7 m", min: 0.45, max: 0.7, radius: 0.15, settle: false },
    { name: "średnia 0,9-1,25 m", min: 0.9, max: 1.25, radius: 0.33, settle: true },
  ];
  for (const c of CLASSES) {
    it(`prawdziwa skała ${c.name} z generatora: z którejś strony da się na nią wskoczyć, stoi się na niej stabilnie i nie zsuwa`, () => {
      const real = rocksOf(V5).find((o) => o.rock!.standable && o.rock!.height > c.min && o.rock!.height < c.max && o.rock!.topRadius > c.radius)!;
      expect(real).toBeDefined();
      const copy = makeObject({ ...real, x: 0, z: 0, y: 0 });
      const world = rockWorld([copy]);
      const topX = copy.rock!.topOffset[0];
      const topZ = copy.rock!.topOffset[1];
      let landed = false;
      for (let k = 0; k < 16 && !landed; k++) {
        const heading = (k / 16) * Math.PI * 2;
        const dirX = Math.sin(heading);
        const dirZ = -Math.cos(heading);
        for (let dist = 5.2; dist > 1.2 && !landed; dist -= 0.1) {
          // Start 6 m od środka wierzchu, skok po przebyciu drogi do `dist`.
          const start = { x: topX - dirX * 6, z: topZ - dirZ * 6 };
          const ctl = makeControllerAt(world, start.x, start.z, undefined, heading);
          let jumped = false;
          for (let i = 0; i < 60 * 4 && !landed; i++) {
            const remaining = Math.hypot(topX - ctl.state.x, topZ - ctl.state.z);
            const wantJump = !jumped && remaining <= dist;
            if (wantJump) jumped = true;
            ctl.update(1 / 60, idleIntent({ moveY: i < 150 ? 1 : 0, run: true, jump: wantJump }), heading);
            if (ctl.state.justLanded && ctl.state.support?.id === real.id) {
              landed = true;
              expect(ctl.state.y).toBeCloseTo(rockSurfaceY(copy, ctl.state.x, ctl.state.z), 2);
              expect(ctl.state.y).toBeLessThanOrEqual(rockWallTop(copy));
              // Na dużej skale bez dalszych poleceń postać zostaje na niej (nie zsuwa się ani nie zapada).
              for (let j = 0; j < 180 && c.settle; j++) ctl.update(1 / 60, idleIntent({}), heading);
              // Mała skała: po lądowaniu bieg niesie postać dalej, więc sprawdzamy tylko moment lądowania.
              expect(ctl.state.support?.id).toBe(real.id);
              expect(ctl.state.grounded).toBe(true);
              expect(ctl.state.y).toBeCloseTo(rockSurfaceY(copy, ctl.state.x, ctl.state.z), 3);
            }
          }
        }
      }
      expect(landed).toBe(true);
    });
  }
});
