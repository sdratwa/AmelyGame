import { describe, expect, it } from "vitest";
import { QUEST_BRIDGE_01 } from "../content/quests";
import { applyCommand } from "../core/apply";
import type { GameState } from "../core/state";
import { FOREST_START } from "../world/generators/v2";
import { forestChestsOf, forestOf } from "../world/lookup";
import { anchorsOf, grantItem, inForest, newPlaying, run, unlockToolOrder } from "../testkit";
import { arrowRotation, buildMinimapModel, projectToMap, searchAreaFor, searchAreas, SEARCH_AREA_OFFSET, SEARCH_AREA_RADIUS } from "./minimap";

const SEEDS = [1, 2, 3, 7, 42, 99, 777, 2030, 31337, 123456, 4000000000];

const active = (seed: number): GameState => run(inForest(newPlaying(seed)), { type: "quest.accept", id: QUEST_BRIDGE_01 });

describe("M1: minimapa lasu", () => {
  it("rzut na mapę: narożniki, środek, północ u góry, wschód po prawej; strzałka zgodna ze zwrotem patrzenia", () => {
    const m = buildMinimapModel(1);
    expect(projectToMap(m.bounds, 200, { x: -150, z: -150 })).toEqual({ x: 0, y: 0 });
    expect(projectToMap(m.bounds, 200, { x: 150, z: 150 })).toEqual({ x: 200, y: 200 });
    expect(projectToMap(m.bounds, 200, { x: 0, z: 0 })).toEqual({ x: 100, y: 100 });
    const north = projectToMap(m.bounds, 300, { x: 0, z: -60 });
    expect(north.y).toBeLessThan(150);
    const east = projectToMap(m.bounds, 300, { x: 60, z: 0 });
    expect(east.x).toBeGreaterThan(150);
    // Gracz o yaw = 0 patrzy w stronę -Z (w górę mapy); wektor "do przodu" po obrocie strzałki musi się zgadzać ze światem.
    for (const yaw of [0, 0.7, -1.2, Math.PI / 2, 2.5]) {
      const rot = arrowRotation(yaw);
      const screen = { x: Math.sin(rot), y: -Math.cos(rot) };
      const world = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
      expect(screen.x).toBeCloseTo(world.x, 9);
      expect(screen.y).toBeCloseTo(world.z, 9);
    }
  });

  it("odwzorowuje las 300 x 300 m: granice regionu, rzeka z prawdziwej geometrii, punkt wejścia i ścieżki w granicach", () => {
    for (const seed of SEEDS) {
      const forest = forestOf(seed);
      const m = buildMinimapModel(seed);
      expect(m.bounds).toEqual({ minX: -150, minZ: -150, maxX: 150, maxZ: 150 });
      expect(m.river.left).toHaveLength(m.river.right.length);
      expect(m.river.left.length).toBeGreaterThanOrEqual(60);
      for (let i = 0; i < m.river.left.length; i++) {
        const l = m.river.left[i];
        const r = m.river.right[i];
        const real = forest.geometry.riverAt(l.z);
        expect(l.z).toBe(r.z);
        expect(l.x).toBeCloseTo(real.x - real.w, 9);
        expect(r.x).toBeCloseTo(real.x + real.w, 9);
        expect(r.x - l.x).toBeGreaterThan(2);
      }
      expect(m.entry).toEqual({ x: FOREST_START.x, z: FOREST_START.z });
      expect(m.trails.some((t) => t.main)).toBe(true);
      for (const t of m.trails) for (const p of t.points) expect(Math.abs(p.x) <= 150 && Math.abs(p.z) <= 150).toBe(true);
      expect(buildMinimapModel(seed)).toBe(m);
    }
  });

  it("NIE ujawnia dokładnych lokalizacji: ścieżki i znaczniki są daleko od skrzyń i trolla, a model nie zawiera ich współrzędnych", () => {
    for (const seed of SEEDS) {
      const forest = forestOf(seed);
      const m = buildMinimapModel(seed);
      const secret = [...forestChestsOf(seed).map((c) => ({ x: c.x, z: c.z })), forest.features.poi("poi.troll_bridge")!];
      for (const s of secret) {
        // Odgałęzienia (które prowadzą na polany) są ucięte, więc kończą się daleko od celu; ścieżka główna to realna droga
        // przez las i może przechodzić w pobliżu polany, ale nigdy przez sam punkt.
        for (const t of m.trails) {
          const min = t.main ? 3 : 15;
          for (const p of t.points) expect(Math.hypot(p.x - s.x, p.z - s.z), `${seed} ${t.id}`).toBeGreaterThan(min);
        }
        expect(Math.hypot(m.entry.x - s.x, m.entry.z - s.z)).toBeGreaterThan(20);
      }
      const text = JSON.stringify(m);
      for (const s of secret) {
        expect(text).not.toContain(`"x":${s.x},"z":${s.z}`);
      }
      expect(text).not.toMatch(/chest|troll|poi\./i);
    }
  });

  it("obszary poszukiwań: tylko dla aktywnego zadania; na początku wyłącznie skrzynia ze schematem, leży w kole, ale środek jest przesunięty", () => {
    for (const seed of SEEDS) {
      expect(searchAreas(inForest(newPlaying(seed)))).toEqual([]);
      const s = active(seed);
      const areas = searchAreas(s);
      expect(areas.map((a) => a.chest)).toEqual(["chest.bridge.blueprint"]);
      for (const a of areas) {
        expect(a.kind).toBe("chest");
        const c = forestChestsOf(seed).find((p) => p.id === a.chest)!;
        const d = Math.hypot(a.x - c.x, a.z - c.z);
        expect(a.r).toBe(SEARCH_AREA_RADIUS);
        expect(d, `${seed} ${a.chest}`).toBeLessThan(a.r * 0.6);
        // Pozycja w oknie przesunięcia, chyba że przycięcie do granic lasu zbliżyło środek.
        expect(d).toBeGreaterThan(0);
        expect(d).toBeLessThanOrEqual(SEARCH_AREA_OFFSET[1] * SEARCH_AREA_RADIUS + 1e-9);
        expect(Math.abs(a.x) <= 150 && Math.abs(a.z) <= 150).toBe(true);
        expect(searchAreaFor(seed, a.chest!, c)).toEqual(a);
      }
    }
  });

  it("skrzynie z narzędziami pojawiają się na minimapie dopiero po zdobyciu schematu i znikają po otwarciu skrzyni", () => {
    const seed = 777;
    let s = active(seed);
    expect(searchAreas(s).map((a) => a.chest)).not.toContain("chest.bridge.saw");
    s = unlockToolOrder(s);
    expect(searchAreas(s).map((a) => a.chest).sort()).toEqual(["chest.bridge.pickaxe", "chest.bridge.saw"]);
    const saw = forestChestsOf(seed).find((c) => c.id === "chest.bridge.saw")!;
    const pick = forestChestsOf(seed).find((c) => c.id === "chest.bridge.pickaxe")!;
    s = applyCommand(s, { type: "chest.open", id: "chest.bridge.saw", at: { x: saw.x + 1.5, z: saw.z } }).state;
    expect(searchAreas(s).map((a) => a.chest)).toEqual(["chest.bridge.pickaxe"]);
    s = applyCommand(s, { type: "chest.take", id: "chest.bridge.saw", at: { x: saw.x + 1.5, z: saw.z } }).state;
    s = applyCommand(s, { type: "chest.open", id: "chest.bridge.pickaxe", at: { x: pick.x + 1.5, z: pick.z } }).state;
    s = applyCommand(s, { type: "chest.take", id: "chest.bridge.pickaxe", at: { x: pick.x + 1.5, z: pick.z } }).state;
    // Etap materiałów nie ma obszarów na mapie.
    expect(searchAreas(s)).toEqual([]);
  });

  it("miejsce budowy pojawia się dopiero po zebraniu materiałów, a po zbudowaniu mostu mapa pokazuje most i obszar za rzeką", () => {
    for (const seed of [1, 777, 31337]) {
      let s = grantItem(active(seed), "item.bridge_blueprint", 1);
      s = grantItem(s, "item.saw", 1);
      s = grantItem(s, "item.pickaxe", 1);
      s = grantItem(s, "resource.wood", 4);
      s = grantItem(s, "resource.stone", 10);
      expect(searchAreas(s).filter((a) => a.kind !== "chest")).toEqual([]);
      s = grantItem(s, "resource.wood", 1);
      const a = anchorsOf(s);
      const areas = searchAreas(s);
      expect(areas.map((x) => x.kind)).toEqual(["bridge_site"]);
      const site = areas[0];
      const d = Math.hypot(site.x - a.bridge.x, site.z - a.bridge.z);
      expect(d, `seed ${seed}`).toBeGreaterThan(0);
      expect(d).toBeLessThanOrEqual(site.r * 0.55 + 1e-9);

      s = run(s, { type: "bridge.build", at: { x: a.bridge.west.x + 0.5, z: a.bridge.west.z } });
      expect(s.bridge.built).toBe(true);
      const after = searchAreas(s);
      expect(after.map((x) => x.kind)).toEqual(["crossing", "beyond"]);
      const beyond = after[1];
      expect(Math.hypot(beyond.x - a.beyond.x, beyond.z - a.beyond.z)).toBeGreaterThan(0);
      expect(Math.hypot(beyond.x - a.beyond.x, beyond.z - a.beyond.z)).toBeLessThan(beyond.r);

      s = run(s, { type: "region.discover", id: a.beyond.region, at: { x: a.beyond.x + 0.5, z: a.beyond.z } });
      expect(s.quests.completed[QUEST_BRIDGE_01]).toBeTruthy();
      expect(searchAreas(s)).toEqual([]);
    }
  });

  it("nie przecieka przez powtórne wywołanie: ten sam wynik, zależny tylko od seeda i stanu questa", () => {
    const a = searchAreas(active(2030));
    const b = searchAreas(active(2030));
    expect(a).toEqual(b);
    expect(searchAreas(active(2031))).not.toEqual(a);
  });
});
