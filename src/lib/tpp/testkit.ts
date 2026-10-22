import { parseWithoutTextures, publicDir, readJsonFile } from "@/lib/assets/glbTestkit";
import { loadPlayerAsset, type PlayerAsset } from "@/lib/assets/characters";
import type { WalkWorld } from "@/lib/game/world/walk";
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
