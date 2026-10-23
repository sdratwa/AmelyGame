import { parseWithoutTextures, publicDir, readJsonFile } from "@/lib/assets/glbTestkit";
import { loadPlayerAsset, type PlayerAsset } from "@/lib/assets/characters";
import { FOREST_START_REGION } from "@/lib/game/world/bounds";
import { makeObject, type WorldObject } from "@/lib/game/world/objects";
import { buildRockProfile, ROCK_PHYSICS, ROCK_SHAPES_V1 } from "@/lib/game/world/rockPhysics";
import { makeField } from "@/lib/game/world/terrain";
import { WalkWorld, type Barrier } from "@/lib/game/world/walk";
import { TPP_DEFAULTS, type TppConfig } from "./config";
import { PlayerController, type PlayerWorld } from "./playerController";
import type { PlayerIntent } from "./playerInput";

export const idleIntent = (patch: Partial<PlayerIntent> = {}): PlayerIntent => ({ moveX: 0, moveY: 0, run: false, crouchToggle: false, jump: false, lookDx: 0, lookDy: 0, ...patch });

/** Płaski świat bez przeszkód (opcjonalnie z funkcją terenu i ścianą), do testów kontrolera bez generatora lasu. */
export function flatWorld(options: { ground?: (x: number, z: number) => number; wallX?: number; canStand?: () => boolean } = {}): PlayerWorld {
  const walk = {
    config: { playerRadius: 0.4, maxSlopeDeg: 35, edgeMargin: 0.5 },
    move: (_from: { x: number; z: number }, to: { x: number; z: number }) => {
      const x = options.wallX !== undefined ? Math.min(to.x, options.wallX) : to.x;
      return { x, z: to.z, blocked: x !== to.x ? [{ reason: "object" as const }] : [] };
    },
  } as unknown as Pick<WalkWorld, "move" | "config">;
  return { walk, groundAt: options.ground ?? (() => 0), canStand: options.canStand ? () => options.canStand!() : undefined };
}

export const makeController = (world: PlayerWorld = flatWorld(), config: Partial<TppConfig> = {}, yaw = 0) =>
  new PlayerController(world, { ...TPP_DEFAULTS, ...config }, { x: 0, z: 0, yaw });

/** Symuluje `seconds` przy stałej liczbie klatek na sekundę; `intent` jest wołany dla każdej klatki. */
export function simulate(ctl: PlayerController, seconds: number, fps: number, intent: (i: number) => PlayerIntent, cameraYaw = 0): void {
  const n = Math.round(seconds * fps);
  for (let i = 0; i < n; i++) ctl.update(1 / fps, intent(i), cameraYaw);
}

/** Dziewczynka wczytana z `public/characters` bez tekstur (patrz `glbTestkit`): szkielet, skóra i animacje są prawdziwe. */
export const loadTestPlayer = (): Promise<PlayerAsset> =>
  loadPlayerAsset({
    loadJson: async (url) => readJsonFile(publicDir(url.replace(/^\//, ""))),
    loadGlb: (url) => parseWithoutTextures(publicDir(url.replace(/^\//, ""))),
  });

/**
 * Skała testowa z prawdziwym profilem fizyki v1 (`buildRockProfile`): model `medium.1` o skali pionowej dobranej tak, by
 * szczyt miał wysokość `height` (m), z kolizją kołową o promieniu `r`. Wierzch leży w odległości ok. 0,65 m od środka
 * obiektu w stronę +Z (środek wierzchu modelu), co odzwierciedla prawdziwe skały.
 */
export function testRock(id: string, x: number, z: number, height: number, options: { r?: number; y?: number; sx?: number; tilt?: readonly [number, number]; yaw?: number; variant?: string } = {}): WorldObject {
  const r = options.r ?? 1.2;
  // Wysokość środka dysku stania to (y płaszczyzny - zagłębienie) * skala Y (bez przechyłu).
  const sy = height / (ROCK_SHAPES_V1[`rock.${options.variant ?? "medium.1"}`].plane.y - ROCK_PHYSICS.sink);
  const sx = options.sx ?? 1;
  const collider = { shape: "circle", r } as const;
  const base = { kind: "rock", variant: options.variant ?? "medium.1", scaleXYZ: [sx, sy, sx] as const, yaw: options.yaw ?? 0, tilt: options.tilt ?? ([0, 0] as const), collider };
  const rock = buildRockProfile(base);
  return makeObject({ id, x, z, y: options.y ?? 0, ...base, ...(rock ? { rock } : {}), radius: r + 0.1 });
}

/** Prawdziwy `WalkWorld` (granice lasu, kolizje obiektów i skał) z funkcją terenu i opcjonalnymi barierami. */
export function rockWorld(objects: readonly WorldObject[], options: { ground?: (x: number, z: number) => number; barriers?: readonly Barrier[] } = {}): PlayerWorld & { walk: WalkWorld } {
  const terrain = makeField(options.ground ?? (() => 0));
  const walk = new WalkWorld({ regions: [FOREST_START_REGION], terrain, objects, barriers: options.barriers, cellSize: 10 });
  return { walk, groundAt: (x, z) => terrain.height(x, z) };
}

/** Kontroler startujący w (x, z) zwrócony do kierunku `yaw` (0 = -Z). */
export const makeControllerAt = (world: PlayerWorld, x: number, z: number, config: Partial<TppConfig> = {}, yaw = 0) =>
  new PlayerController(world, { ...TPP_DEFAULTS, ...config }, { x, z, yaw });
