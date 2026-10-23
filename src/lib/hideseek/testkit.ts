import { DEFAULT_HIDESEEK_CONFIG } from "./config";
import { HideSeekSession } from "./session";
import type { HideSeekConfig, HsSpot } from "./types";

/** Deterministyczny generator (mulberry32) do testów. */
export function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class FakeClock {
  t = 1_000_000;
  now = () => this.t;
  advance(ms: number) {
    this.t += ms;
  }
}

export const BOUNDS = { minX: -150, minZ: -150, maxX: 150, maxZ: 150 };

export type Kit = {
  clock: FakeClock;
  session: HideSeekSession;
  positions: Map<string, { x: number; y: number; z: number }>;
  spotFor: (x: number, z: number) => HsSpot;
};

/** Sesja z hostem „A” i zaproszonymi „B”, „C”... (liczba graczy `n` łącznie). */
export function makeKit(n = 3, config: Partial<HideSeekConfig> = {}, seed = 7): Kit {
  const clock = new FakeClock();
  const positions = new Map<string, { x: number; y: number; z: number }>();
  const keys = Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));
  keys.forEach((k, i) => positions.set(k, { x: i * 10, y: 0, z: 0 }));
  const session = new HideSeekSession({
    id: "s1",
    now: clock.now,
    rng: seeded(seed),
    config: { ...DEFAULT_HIDESEEK_CONFIG, ...config },
    host: { key: "A", name: "Gracz A" },
    eligible: keys.slice(1).map((k) => ({ key: k, name: `Gracz ${k}` })),
    bounds: BOUNDS,
    positionOf: (k) => positions.get(k) ?? null,
    autoSpot: (k) => {
      const p = positions.get(k);
      return p ? { x: p.x, y: p.y, z: p.z, supportId: null } : null;
    },
  });
  return { clock, session, positions, spotFor: (x, z) => ({ x, y: 0, z, supportId: null }) };
}

/** Doprowadza sesję do fazy HIDING (wszyscy zaproszeni przyjmują). */
export function toHiding(kit: Kit) {
  for (const k of ["B", "C", "D", "E", "F", "G", "H"]) kit.session.respond(k, true);
  if (kit.session.phase === "INVITING") {
    kit.clock.advance(31_000);
    kit.session.advance();
  }
  return kit;
}

/** Doprowadza sesję do fazy SEEKING; ukrywający zatwierdzają kryjówki na (20*i, 20) dla i = 1... */
export function toSeeking(kit: Kit) {
  toHiding(kit);
  let i = 1;
  for (const k of ["B", "C", "D", "E", "F", "G", "H"]) {
    if (kit.session.roleOf(k) !== "HIDER_MOVING") continue;
    kit.session.hide(k, kit.spotFor(20 * i, 20));
    i++;
  }
  return kit;
}
