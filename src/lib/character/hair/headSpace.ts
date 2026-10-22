import type { HeadMetrics } from "../head";
import type { Vec3 } from "../meshData";

/**
 * Punkt na elipsoidzie głowy: `theta` 0 = przód (+Z), dodatni w stronę +X; `phi` 0 = czubek, pi/2 = równik; `r` mnoży półosie
 * (1 = powierzchnia skóry). Wspólny język generatorów fryzur.
 */
export function onHead(head: HeadMetrics, theta: number, phi: number, r: number): Vec3 {
  const sp = Math.sin(phi);
  return [head.center[0] + head.radii[0] * r * sp * Math.sin(theta), head.center[1] + head.radii[1] * r * Math.cos(phi), head.center[2] + head.radii[2] * r * sp * Math.cos(theta)];
}

/** Kąt sprowadzony do (-pi, pi]. */
export function wrapPi(a: number): number {
  const two = Math.PI * 2;
  let x = a % two;
  if (x > Math.PI) x -= two;
  if (x <= -Math.PI) x += two;
  return x;
}
