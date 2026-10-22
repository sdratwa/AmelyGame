import type { HeadMetrics } from "../head";
import { MeshBuilder, add, mul, norm, seededRandom, smoothstep, sub, type MeshData, type Vec3 } from "../meshData";
import { onHead, wrapPi } from "./headSpace";

const TWO_PI = Math.PI * 2;

/**
 * HAIR_01 (prototyp proceduralny): krótkie, lekko potargane włosy z grzywką. Czepek przylegający do czaszki z postrzępioną
 * linią włosów, zwężające się kosmyki sterczące na boki i do tyłu oraz ośmioma kosmykami grzywki opadającymi na czoło.
 * Wszystkie wymiary względem głowy (`HeadMetrics`), losowość deterministyczna.
 */
export function buildHair01(head: HeadMetrics): MeshData {
  const rnd = seededRandom(0x0101);
  const b = new MeshBuilder();

  // Czepek: linia włosów niżej na bokach i z tyłu, wyżej nad czołem (tam wchodzi grzywka), lekko poszarpana.
  const hairline = (th: number) => {
    const a = Math.abs(wrapPi(th));
    return 1.02 + 0.52 * smoothstep(0.35, 1.5, a) + 0.22 * smoothstep(1.7, 3.0, a) + 0.045 * Math.sin(th * 7 + 0.6);
  };
  b.grid(
    9,
    28,
    (u, v) => {
      const th = v * TWO_PI;
      const r = 1.05 + 0.016 * Math.sin(th * 5 + u * 3) + 0.012 * u;
      return onHead(head, th, u * hairline(th), r);
    },
    true,
  );

  // Sterczące kosmyki (poza przodem, gdzie jest grzywka).
  const tufts = 20;
  for (let i = 0; i < tufts; i++) {
    const th = ((i + rnd() * 0.6) / tufts) * TWO_PI;
    if (Math.abs(wrapPi(th)) < 0.65) continue;
    const phi = 0.45 + rnd() * 0.75;
    const p0 = onHead(head, th, phi, 1.05);
    const outward = norm([(p0[0] - head.center[0]) / head.radii[0] ** 2, (p0[1] - head.center[1]) / head.radii[1] ** 2, (p0[2] - head.center[2]) / head.radii[2] ** 2]);
    const down = norm(sub(onHead(head, th, phi + 0.12, 1.05), p0));
    const side = norm([Math.cos(th), 0, -Math.sin(th)]);
    const dir = norm(add(add(mul(outward, 0.42), mul(down, 0.55)), mul(side, (rnd() - 0.5) * 0.7)));
    const length = 0.04 + rnd() * 0.026;
    const path: Vec3[] = [p0, add(p0, mul(dir, length * 0.38)), add(add(p0, mul(dir, length * 0.72)), mul(down, length * 0.08)), add(add(p0, mul(dir, length)), mul(down, length * 0.2))];
    const w = 0.011 + rnd() * 0.004;
    b.tube(path, (t) => [w * (1 - t) + 0.0025, w * 0.65 * (1 - t) + 0.002], 5, side);
  }

  // Grzywka: kosmyki opadają z czubka na czoło, lekko rozchylone i zmiatane w bok.
  const bangs = 8;
  for (let k = 0; k < bangs; k++) {
    const f = k / (bangs - 1);
    const th0 = (f - 0.5) * 1.5;
    const sweep = 0.12 + (f - 0.5) * 0.1;
    const phiEnd = 1.2 + 0.05 * Math.sin(k * 1.7) - 0.04 * Math.abs(f - 0.5);
    const path: Vec3[] = [];
    const steps = 5;
    for (let s = 0; s < steps; s++) {
      const t = s / (steps - 1);
      path.push(onHead(head, th0 + sweep * t * t, 0.5 + (phiEnd - 0.5) * t, 1.06 + 0.04 * Math.sin(t * Math.PI)));
    }
    const w = 0.0165 - 0.004 * Math.abs(f - 0.5);
    b.tube(path, (t) => [w * (1 - 0.65 * t * t) + 0.002, 0.0065 * (1 - 0.5 * t) + 0.0015], 6, [1, 0, 0]);
  }

  return b.build();
}
