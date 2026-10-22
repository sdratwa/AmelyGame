import type { SharedWorld } from "./sharedWorld";
export const PROTOCOL = 3;
export const NET = { hz: 20, interpolationMs: 100, maxPlayers: 8 };
export type Motion = {
  sequence: number;
  x: number;
  y: number;
  z: number;
  bodyYaw: number;
  vx: number;
  vz: number;
  speed: number;
  crouching: boolean;
  grounded: boolean;
  running: boolean;
  jumpSequence: number;
  animation: string;
};
export type Player = Motion & {
  playerId: string;
  sessionId: string;
  name: string;
};
export type WorldConfig = {
  worldId: string;
  worldInstanceId: string;
  worldSeed: number;
  generatorVersion: number;
  fingerprint: string;
};
export type Snapshot = { serverTime: number; worldElapsed: number; players: Player[] };
export type Welcome = { config: WorldConfig; player: Player; worldElapsed: number; world: SharedWorld };
export const SOUND_REGISTRY: Record<
  "HELP_SHOUT",
  {
    asset: string | null;
    range: number;
    gain: number;
    refDistance: number;
    rolloff: number;
    priority: number;
  }
> = {
  HELP_SHOUT: {
    asset: null,
    range: 120,
    gain: 1,
    refDistance: 12,
    rolloff: 1,
    priority: 2,
  },
} as const;
export type PlayerSoundEvent = {
  eventId: string;
  playerId: string;
  worldInstanceId: string;
  soundId: keyof typeof SOUND_REGISTRY;
  sequence: number;
  serverTime: number;
  x: number;
  y: number;
  z: number;
};
const animations = [
  "idle",
  "walk",
  "run",
  "jump",
  "crouch_idle",
  "crouch_walk_forward",
  "crouch_walk_back",
  "crouch_sneak_left",
  "crouch_sneak_right",
];
export function validMotion(v: unknown): v is Motion {
  if (!v || typeof v !== "object") return false;
  const m = v as Motion;
  if (Object.keys(m).some((key) => !Object.hasOwn(idleMotion(0, 0, 0), key)))
    return false;
  return (
    [m.sequence, m.jumpSequence].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    ) &&
    [m.x, m.y, m.z, m.bodyYaw, m.vx, m.vz, m.speed].every(Number.isFinite) &&
    Math.abs(m.x) < 150 &&
    Math.abs(m.z) < 150 &&
    Math.abs(m.y) < 100 &&
    Math.abs(m.bodyYaw) < 100000 &&
    Math.abs(m.vx) <= 20 &&
    Math.abs(m.vz) <= 20 &&
    m.speed >= 0 &&
    m.speed <= 20 &&
    [m.crouching, m.grounded, m.running].every((b) => typeof b === "boolean") &&
    animations.includes(m.animation)
  );
}
export function idleMotion(x: number, y: number, z: number): Motion {
  return {
    sequence: 0,
    x,
    y,
    z,
    bodyYaw: 0,
    vx: 0,
    vz: 0,
    speed: 0,
    crouching: false,
    grounded: true,
    running: false,
    jumpSequence: 0,
    animation: "idle",
  };
}
