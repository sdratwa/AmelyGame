import type { AssetManifest, ModelEntry, ScaleClassId } from "./manifest";
import type { Placement } from "./instancing";

export type RockPick = {
  modelId: string;
  sizeClass: ScaleClassId;
  /** Skala osi (x, y, z); jednolita skala klasy pomnożona przez kontrolowaną zmienność proporcji. */
  scale: [number, number, number];
  yaw: number;
  tiltX: number;
  tiltZ: number;
  /** Ile jednostek surowca ma dawać taka skała (podpowiedź dla mechaniki: 1/2/5). */
  harvestHint: number;
};

const between = (rand: () => number, lo: number, hi: number) => lo + rand() * (hi - lo);

/**
 * Wariant A (prototyp): klasy S/M/L skał z `Rock_Medium_*` przez skalowanie. Losowość pochodzi wyłącznie z `rand`
 * (przekaż strumień z `rngStream`), więc wynik jest powtarzalny dla ziarna świata.
 * Zmienność proporcji jest ograniczona (np. +-12% na osiach), żeby skała nie wyglądała na zdeformowaną.
 */
export function pickRock(manifest: AssetManifest, sizeClass: ScaleClassId, rand: () => number): RockPick {
  const cfg = manifest.scaleClasses.rock;
  const models = cfg.appliesTo;
  const modelId = models[Math.min(models.length - 1, Math.floor(rand() * models.length))];
  const cls = cfg.classes[sizeClass];
  const base = between(rand, cls.scale[0], cls.scale[1]);
  const j = cfg.proportionJitter;
  const axis = (jitter: number) => base * (1 + between(rand, -jitter, jitter));
  return {
    modelId,
    sizeClass,
    scale: [axis(j.x), axis(j.y), axis(j.z)],
    yaw: between(rand, cfg.yawRange[0], cfg.yawRange[1]),
    tiltX: between(rand, -cfg.maxTiltRad, cfg.maxTiltRad),
    tiltZ: between(rand, -cfg.maxTiltRad, cfg.maxTiltRad),
    harvestHint: cls.harvestHint,
  };
}

export function rockPlacement(pick: RockPick, x: number, y: number, z: number): Placement {
  return { x, y, z, yaw: pick.yaw, scale: pick.scale, tiltX: pick.tiltX, tiltZ: pick.tiltZ };
}

/**
 * Kolizja koła w płaszczyźnie x-z dla instancji modelu (zgodna z `Collider` kształtu "circle" ze świata W0).
 * Skala osi: promień liczony ze średniej skali x i z. Zwraca null, gdy model nie ma kolizji (da się go przejść).
 */
export function placementCollider(
  entry: Pick<ModelEntry, "collision">,
  scale: number | readonly [number, number, number] = 1,
): { shape: "circle"; r: number } | null {
  if (!entry.collision) return null;
  const s = typeof scale === "number" ? scale : (scale[0] + scale[2]) / 2;
  return { shape: "circle", r: entry.collision.r * s };
}
