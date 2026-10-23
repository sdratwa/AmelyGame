import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { DEFAULT_LANTERN_CONFIG, candelaOf, type LanternConfig } from "./config";
import { LanternSystem, type LanternFrameEnv, type LanternSource } from "./system";

const cfg = (patch: Partial<LanternConfig> = {}): LanternConfig => ({ ...DEFAULT_LANTERN_CONFIG, flickerEnabled: false, ...patch });

function setup(config = cfg(), opts: { poolSize?: number; allowShadows?: boolean } = {}) {
  const scene = new THREE.Scene();
  const system = new LanternSystem(config, { poolSize: opts.poolSize ?? 4, allowShadows: opts.allowShadows ?? true, glowTextureSize: 8 });
  scene.add(system.group);
  return { scene, system };
}

/** Kość dłoni gracza stojącego w (x, 0, 0): rodzic ze skalą 1,55 jak model postaci. */
function hand(scene: THREE.Scene, x: number, z = 0) {
  const holder = new THREE.Group();
  holder.scale.setScalar(1.55);
  holder.position.set(x, 0, z);
  const bone = new THREE.Object3D();
  bone.position.set(0, 0.5, 0);
  holder.add(bone);
  scene.add(holder);
  return bone;
}

const env = (patch: Partial<LanternFrameEnv> = {}): LanternFrameEnv => ({
  time: 0,
  dt: 1 / 60,
  daylight: 0,
  fogDensity: 0,
  camera: { x: 0, y: 1.5, z: 0 },
  fovRad: (60 * Math.PI) / 180,
  viewportHeightPx: 1080,
  heightAt: null,
  ...patch,
});

const src = (id: string, bone: THREE.Object3D | null, enabled = true, priority = false): LanternSource => ({ id, enabled, hand: bone, seed: id.length * 7.3, priority });

const lights = (system: LanternSystem) => system.group.children.filter((c): c is THREE.PointLight => (c as THREE.PointLight).isPointLight);
const sprites = (system: LanternSystem) => system.group.children.filter((c): c is THREE.Sprite => (c as THREE.Sprite).isSprite);
const run = (system: LanternSystem, sources: LanternSource[], frames = 30, patch: Partial<LanternFrameEnv> = {}) => {
  for (let i = 0; i < frames; i++) system.update(sources, env({ time: i / 60, ...patch }));
};

describe("LanternSystem: stan ON/OFF i czyszczenie", () => {
  it("zapalona lampa trafia do dłoni, zgaszona znika, a ponowne zapalenie działa wielokrotnie", () => {
    const { scene, system } = setup();
    const bone = hand(scene, 2);
    for (let i = 0; i < 3; i++) {
      run(system, [src("a", bone, true)], 5);
      expect(bone.children.length).toBe(1);
      expect(system.activeCount).toBe(1);
      expect(sprites(system).length).toBe(1);
      run(system, [src("a", bone, false)], 5);
      expect(bone.children.length).toBe(0);
      expect(system.activeCount).toBe(0);
      expect(sprites(system).length).toBe(0);
      expect(lights(system).every((l) => l.intensity === 0)).toBe(true);
    }
  });

  it("brak kości dłoni nie tworzy lampy; odejście gracza (zniknięcie ze źródeł) sprząta model, sprite i światło", () => {
    const { scene, system } = setup();
    const bone = hand(scene, 3);
    run(system, [src("a", null, true)], 3);
    expect(system.activeCount).toBe(0);
    run(system, [src("a", bone, true)], 10);
    expect(system.activeCount).toBe(1);
    expect(lights(system).some((l) => l.intensity > 0)).toBe(true);
    run(system, [], 3);
    expect(bone.children.length).toBe(0);
    expect(sprites(system).length).toBe(0);
    expect(lights(system).every((l) => l.intensity === 0)).toBe(true);
  });

  it("izolacja graczy: zapalenie jednego nie zapala cudzej lampy", () => {
    const { scene, system } = setup();
    const a = hand(scene, 2);
    const b = hand(scene, -2);
    run(system, [src("a", a, true), src("b", b, false)], 5);
    expect(a.children.length).toBe(1);
    expect(b.children.length).toBe(0);
    run(system, [src("a", a, false), src("b", b, true)], 5);
    expect(a.children.length).toBe(0);
    expect(b.children.length).toBe(1);
  });

  it("późne dołączenie: lampa, która już świeci, jest widoczna od pierwszej klatki z blaskiem i światłem", () => {
    const { scene, system } = setup();
    const bone = hand(scene, 4);
    system.update([src("late", bone, true)], env());
    expect(system.activeCount).toBe(1);
    expect(sprites(system)[0].visible).toBe(true);
  });

  it("reconnect: nowy obiekt kości zastępuje stary bez osieroconych lamp", () => {
    const { scene, system } = setup();
    const old = hand(scene, 2);
    run(system, [src("p", old, true)], 5);
    const fresh = hand(scene, 2);
    run(system, [src("p", fresh, true)], 5);
    expect(old.children.length).toBe(0);
    expect(fresh.children.length).toBe(1);
    expect(system.activeCount).toBe(1);
    expect(sprites(system).length).toBe(1);
  });

  it("opuszczenie świata: dispose zwalnia wszystko, a kolejne klatki nic nie tworzą", () => {
    const { scene, system } = setup();
    const bones = [hand(scene, 2), hand(scene, -3), hand(scene, 5)];
    run(system, bones.map((b, i) => src(`p${i}`, b)), 10);
    system.dispose();
    expect(bones.every((b) => b.children.length === 0)).toBe(true);
    expect(system.group.parent).toBeNull();
    expect(system.group.children.length).toBe(0);
    system.update(bones.map((b, i) => src(`p${i}`, b)), env());
    expect(bones.every((b) => b.children.length === 0)).toBe(true);
    expect(system.activeCount).toBe(0);
  });
});

describe("LanternSystem: światło i pula", () => {
  it("pula świateł ma stałą liczbę elementów i nie tworzy nowych obiektów w trakcie klatek", () => {
    const { scene, system } = setup();
    const before = lights(system);
    expect(before.length).toBe(4);
    const bone = hand(scene, 2);
    for (let round = 0; round < 3; round++) {
      run(system, [src("a", bone, true)], 20);
      run(system, [src("a", bone, false)], 5);
    }
    const after = lights(system);
    expect(after).toEqual(before);
    expect(after.every((l, i) => l === before[i])).toBe(true);
  });

  it("parametry światła: kolor #FFBD55, zasięg wygaszania, zanik i natężenie z konfiguracji", () => {
    const config = cfg();
    const { scene, system } = setup(config);
    const bone = hand(scene, 2);
    run(system, [src("a", bone, true, true)], 60);
    const lit = lights(system).filter((l) => l.intensity > 0);
    expect(lit.length).toBe(1);
    const light = lit[0];
    expect(light.distance).toBe(config.radius * config.fadeReach);
    expect(light.decay).toBe(config.decay);
    expect(light.intensity).toBeCloseTo(candelaOf(config), 1);
    const expected = new THREE.Color().setRGB(1, 189 / 255, 85 / 255, THREE.SRGBColorSpace);
    expect(light.color.r).toBeCloseTo(expected.r, 5);
    expect(light.color.g).toBeCloseTo(expected.g, 5);
    expect(light.color.b).toBeCloseTo(expected.b, 5);
    expect(light.castShadow).toBe(false);
  });

  it("światło idzie za płomieniem z przesunięciem pionowym i wyłączenie `lightEnabled` zgasza je, zostawiając blask", () => {
    const { scene, system } = setup(cfg({ heightOffset: 0.3 }));
    const bone = hand(scene, 2);
    run(system, [src("a", bone, true)], 30);
    const light = lights(system).find((l) => l.intensity > 0)!;
    const flame = bone.children[0];
    const world = new THREE.Vector3();
    (flame as THREE.Object3D).traverse((o) => {
      if (o.name === "oil-lantern-flame-anchor") o.getWorldPosition(world);
    });
    expect(light.position.x).toBeCloseTo(world.x, 5);
    expect(light.position.y).toBeCloseTo(world.y + 0.3, 5);
    system.setConfig(cfg({ lightEnabled: false }));
    run(system, [src("a", bone, true)], 30);
    expect(lights(system).every((l) => l.intensity === 0)).toBe(true);
    expect(sprites(system)[0].visible).toBe(true);
  });

  it("maksymalna liczba aktywnych świateł: najbliższe dostają światło, reszta tylko blask; lokalna ma priorytet", () => {
    const { scene, system } = setup(cfg({ maxLights: 2 }));
    const sources = [src("far", hand(scene, 25)), src("near", hand(scene, 3)), src("mid", hand(scene, 8)), src("mine", hand(scene, 20), true, true)];
    run(system, sources, 30);
    const lit = lights(system).filter((l) => l.intensity > 0);
    expect(lit.length).toBe(2);
    expect(system.stats().lights).toBe(2);
    expect(system.stats().lit).toBe(4);
    // Lokalna (daleko, ale priorytetowa) i najbliższa mają światło.
    const xs = lit.map((l) => Math.round(l.position.x)).sort((a, b) => a - b);
    expect(xs[0]).toBeLessThan(6);
    expect(xs[1]).toBeGreaterThan(15);
    expect(sprites(system).length).toBe(4);
  });

  it("sloty są lepkie: gdy jedna lampa znika, pozostałe nie zmieniają źródła światła", () => {
    const { scene, system } = setup();
    const a = hand(scene, 3);
    const b = hand(scene, 5);
    const c = hand(scene, 7);
    run(system, [src("a", a), src("b", b), src("c", c)], 40);
    const slotOf = (x: number) => lights(system).findIndex((l) => l.intensity > 0 && Math.abs(l.position.x - x) < 1.5);
    const before = [slotOf(3), slotOf(5), slotOf(7)];
    expect(new Set(before).size).toBe(3);
    run(system, [src("a", a, false), src("b", b), src("c", c)], 40);
    expect(slotOf(5)).toBe(before[1]);
    expect(slotOf(7)).toBe(before[2]);
  });

  it("strefy LOD: FAR (>30 m) nie zajmuje PointLight, ale ma blask; NEAR i MID liczą się w statystykach", () => {
    const { scene, system } = setup();
    const sources = [src("n", hand(scene, 5)), src("m", hand(scene, 20)), src("f", hand(scene, 80))];
    run(system, sources, 30);
    const st = system.stats();
    expect([st.near, st.mid, st.far]).toEqual([1, 1, 1]);
    expect(st.lights).toBe(2);
    expect(st.glows).toBe(3);
  });

  it("zdalna lampa za pasmem MID nie świeci, a po zbliżeniu dostaje światło (progi konfigurowalne)", () => {
    const { scene, system } = setup(cfg({ nearDistance: 4, midDistance: 8 }));
    const bone = hand(scene, 40);
    run(system, [src("a", bone)], 20);
    expect(system.stats().lights).toBe(0);
    bone.parent!.position.x = 5;
    run(system, [src("a", bone)], 20);
    expect(system.stats().lights).toBe(1);
  });
});

describe("LanternSystem: cienie", () => {
  it("telefon (allowShadows = false) nigdy nie rzuca cieni, nawet przy włączonej opcji", () => {
    const { scene, system } = setup(cfg({ shadowsEnabled: true }), { poolSize: 2, allowShadows: false });
    run(system, [src("a", hand(scene, 2), true, true)], 30);
    expect(lights(system).every((l) => !l.castShadow)).toBe(true);
    expect(system.stats().shadows).toBe(false);
  });

  it("na pececie cień ma tylko jedno światło (slot 0, lampa lokalna) i tylko gdy opcja jest włączona", () => {
    const { scene, system } = setup(cfg({ shadowsEnabled: true, shadowQuality: "low" }));
    run(system, [src("other", hand(scene, 3)), src("mine", hand(scene, 6), true, true)], 30);
    const casting = lights(system).filter((l) => l.castShadow);
    expect(casting.length).toBe(1);
    expect(casting[0].position.x).toBeGreaterThan(5);
    expect(casting[0].shadow.mapSize.x).toBe(256);
    expect(system.stats().shadows).toBe(true);
    system.setConfig(cfg({ shadowsEnabled: false }));
    run(system, [src("other", hand(scene, 3)), src("mine", hand(scene, 6), true, true)], 5);
    expect(lights(system).every((l) => !l.castShadow)).toBe(true);
  });

  it("gdy żadna lampa nie świeci, nie ma rzucających cień świateł (brak pustych przebiegów cieni)", () => {
    const { scene, system } = setup(cfg({ shadowsEnabled: true }));
    run(system, [src("a", hand(scene, 2), false)], 5);
    expect(lights(system).every((l) => !l.castShadow)).toBe(true);
  });
});

describe("LanternSystem: blask z daleka", () => {
  it("blask widać na 20/50/100 m w nocy, a za 150 m jest ukryty", () => {
    const { scene, system } = setup();
    const visible: boolean[] = [];
    for (const d of [20, 50, 100, 149, 160]) {
      const bone = hand(scene, d);
      run(system, [src(`p${d}`, bone)], 5);
      visible.push(sprites(system)[0].visible);
      run(system, [], 1);
    }
    expect(visible).toEqual([true, true, true, true, false]);
  });

  it("kierunek i lokalizacja: sprite stoi w miejscu płomienia w świecie", () => {
    const { scene, system } = setup();
    const bone = hand(scene, 60, 30);
    run(system, [src("a", bone)], 5);
    const sprite = sprites(system)[0];
    expect(Math.hypot(sprite.position.x - 60 * 1, sprite.position.z - 30)).toBeLessThan(1);
    expect(sprite.scale.x).toBeGreaterThan(0);
  });

  it("wzgórze między kamerą a lampą wygasza blask, a bez wzgórza blask wraca", () => {
    const { scene, system } = setup();
    const bone = hand(scene, 100);
    const hill = (x: number) => (Math.abs(x - 50) < 10 ? 80 : 0);
    run(system, [src("a", bone)], 120, { heightAt: (x) => hill(x) });
    expect(sprites(system)[0].visible).toBe(false);
    expect(system.stats().occluded).toBe(1);
    run(system, [src("a", bone)], 240, { heightAt: () => 0 });
    expect(sprites(system)[0].visible).toBe(true);
  });

  it("blask słabnie z odległością i we mgle, ale mgła go nie kasuje; dzień go osłabia", () => {
    const { scene, system } = setup();
    const bone = hand(scene, 100);
    const sourcesOf = () => [src("a", bone)];
    run(system, sourcesOf(), 60);
    const clear = sprites(system)[0].material.opacity;
    run(system, sourcesOf(), 60, { fogDensity: 0.02 });
    const foggy = sprites(system)[0].material.opacity;
    expect(foggy).toBeLessThan(clear);
    expect(foggy).toBeGreaterThan(0);
    run(system, sourcesOf(), 60, { daylight: 1 });
    expect(sprites(system)[0].material.opacity).toBeLessThan(clear);
  });

  it("rozmiar blasku jest ograniczony także tuż przy kamerze", () => {
    const { scene, system } = setup();
    const bone = hand(scene, 1.2);
    run(system, [src("a", bone)], 10);
    const sprite = sprites(system)[0];
    const dist = Math.hypot(sprite.position.x, sprite.position.y - 1.5, sprite.position.z);
    const px = (2 * Math.tan((60 * Math.PI) / 360)) / 1080;
    expect(sprite.scale.x / (px * dist)).toBeLessThanOrEqual(160 + 1e-6);
  });
});

describe("LanternSystem: migotanie nie dotyka stanu", () => {
  it("światło migocze w granicach konfiguracji (±10%) i jest deterministyczne dla tego samego czasu", () => {
    const config = { ...DEFAULT_LANTERN_CONFIG };
    const { scene, system } = setup(config);
    const bone = hand(scene, 2);
    const samples: number[] = [];
    for (let i = 0; i < 300; i++) {
      system.update([src("a", bone, true, true)], env({ time: i / 30 }));
      if (i > 20) samples.push(lights(system).find((l) => l.intensity > 0)!.intensity);
    }
    const candela = candelaOf(config);
    expect(Math.max(...samples)).toBeLessThanOrEqual(candela * 1.1 + 1e-6);
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(candela * 0.9 - 1e-6);
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(candela * 0.05);
  });
});
