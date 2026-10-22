import { mulberry32, type Rng } from "../../../core/rng";
import type { Point } from "../../shape";
import type { PavingOptions } from "./pro";
import type { Species } from "./species";

/** Element bruku: płyta (RockPath) albo kamyk (Pebble) leżące na drodze. Bez kolizji (da się chodzić). */
export type PaveItem = { x: number; z: number; sp: Species; scale: number; yaw: number };

const q3 = (v: number) => Math.round(v * 1000) / 1000;
const lerp = (lo: number, hi: number, t: number) => lo + (hi - lo) * t;

type Frame = { x: number; z: number; tx: number; tz: number };

/** Odcinki łamanej ze skumulowaną długością; `at(s)` daje punkt i jednostkową styczną w odległości `s` od początku. */
export class PolylineWalker {
  readonly length: number;
  private readonly cum: number[] = [0];
  constructor(private readonly pts: readonly Point[]) {
    for (let i = 1; i < pts.length; i++) {
      this.cum.push(this.cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    }
    this.length = this.cum[this.cum.length - 1];
  }

  at(s: number): Frame {
    const clamped = Math.max(0, Math.min(this.length, s));
    let lo = 0;
    let hi = this.pts.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] <= clamped) lo = mid;
      else hi = mid;
    }
    const a = this.pts[lo];
    const b = this.pts[hi];
    const seg = this.cum[hi] - this.cum[lo] || 1;
    const t = (clamped - this.cum[lo]) / seg;
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, tx: (b.x - a.x) / seg, tz: (b.z - a.z) / seg };
  }
}

/**
 * Brukowanie drogi w prototypie Pro. Droga jest dzielona na łaty długości `patchLength`; przy początku i końcu (`endZone`) niemal
 * każda łata jest brukowana i układamy po dwie płyty na krok, w środku brukowana jest część łat (szansa `middleChance`), po jednej
 * płycie na krok. Płyty leżą wzdłuż stycznej drogi z niewielkim rozrzutem, a przy brzegach drogi dochodzą kamyki. Wynik zależy
 * wyłącznie od ziarna i geometrii drogi (jeden strumień losowy, przechodzony od początku drogi), więc jest identyczny dla każdego sektora.
 */
export function buildPaving(
  trail: readonly Point[],
  opts: PavingOptions,
  slabs: readonly Species[],
  pebbles: readonly Species[],
  seed: number,
): PaveItem[] {
  const out: PaveItem[] = [];
  if (trail.length < 2 || slabs.length === 0) return out;
  const walker = new PolylineWalker(trail);
  const rng: Rng = mulberry32(seed | 0);
  const pick = (list: readonly Species[]) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
  const L = walker.length;
  const stop = L - 3;
  const patchPaved = new Map<number, boolean>();
  let s = 1.5;
  let guard = 0;
  while (s < stop && guard++ < 5000) {
    const patch = Math.floor(s / opts.patchLength);
    const ends = s < opts.endZone || s > L - opts.endZone;
    let paved = patchPaved.get(patch);
    if (paved === undefined) {
      const roll = rng();
      paved = ends ? roll < 0.96 : roll < opts.middleChance;
      patchPaved.set(patch, paved);
    }
    if (!paved) {
      s = (patch + 1) * opts.patchLength;
      continue;
    }
    const f = walker.at(s);
    const nx = -f.tz;
    const nz = f.tx;
    const rows = ends ? 2 : 1;
    let advance = 0;
    for (let r = 0; r < rows; r++) {
      const sp = pick(slabs);
      const scale = q3(lerp(0.9, 1.15, rng()));
      const lateral = (rows === 2 ? (r === 0 ? -0.6 : 0.6) : 0) + (rng() * 2 - 1) * 0.28;
      const along = (rng() * 2 - 1) * 0.15;
      const yawJitter = (rng() * 2 - 1) * 0.25;
      const flip = rng() < 0.5 ? Math.PI : 0;
      const x = q3(f.x + nx * lateral + f.tx * along);
      const z = q3(f.z + nz * lateral + f.tz * along);
      out.push({ x, z, sp, scale, yaw: q3(Math.atan2(f.tx, f.tz) + yawJitter + flip) });
      advance = Math.max(advance, sp.footprint * 2 * scale * 0.82);
    }
    // Kamyki na brzegach i w szczelinach.
    if (pebbles.length > 0) {
      const count = Math.floor(rng() * 3);
      for (let k = 0; k < count; k++) {
        const side = rng() < 0.5 ? -1 : 1;
        const lateral = side * lerp(0.85, 1.25, rng());
        const along = (rng() * 2 - 1) * 0.8;
        const sp = pick(pebbles);
        out.push({
          x: q3(f.x + nx * lateral + f.tx * along),
          z: q3(f.z + nz * lateral + f.tz * along),
          sp,
          scale: q3(lerp(0.8, 1.5, rng())),
          yaw: q3(rng() * Math.PI * 2),
        });
      }
    }
    s += Math.max(0.8, advance) + rng() * 0.15;
  }
  return out;
}
