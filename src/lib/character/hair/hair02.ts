import type { HeadMetrics } from "../head";
import { MeshBuilder, seededRandom, smoothstep, type MeshData, type Vec3 } from "../meshData";
import { onHead, wrapPi } from "./headSpace";

const TWO_PI = Math.PI * 2;
/** Połowa kąta przodu zostawiona bez włosów (twarz). */
const FACE_GAP = 0.55;

/**
 * HAIR_02 (prototyp proceduralny): włosy średniej długości, prosty bob. Czepek na czaszce, gładka zasłona dookoła
 * głowy (poza twarzą) z lekkim wybrzuszeniem w połowie i podwinięciem przy końcach oraz prosta grzywka. Długość do linii
 * żuchwy, brzeg falowany tak, by czytał się jako pasma, a nie jednolity hełm.
 */
export function buildHair02(head: HeadMetrics): MeshData {
  const rnd = seededRandom(0x0202);
  const phase = rnd() * 2;
  const b = new MeshBuilder();
  const [cx, cy, cz] = head.center;
  const [rx, ry, rz] = head.radii;

  const hairline = (th: number) => 1.0 + 0.35 * smoothstep(0.4, 1.2, Math.abs(wrapPi(th)));
  b.grid(
    9,
    28,
    (u, v) => {
      const th = v * TWO_PI;
      return onHead(head, th, u * hairline(th), 1.05 + 0.012 * u);
    },
    true,
  );

  // Zasłona: od linii włosów na czaszce w dół do żuchwy.
  const phiTop = 1.25;
  const yTop = cy + ry * Math.cos(phiTop);
  const yJaw = cy - ry * 0.935;
  const thetaSpan = TWO_PI - 2 * FACE_GAP;
  b.grid(9, 40, (u, v) => {
    const th = FACE_GAP + v * thetaSpan;
    const scallop = 0.5 + 0.5 * Math.sin(th * 9 + phase);
    const yHem = yJaw + 0.012 - 0.012 * scallop;
    const y = yTop + (yHem - yTop) * u;
    const ell = Math.max(0.8, Math.sqrt(Math.max(0, 1 - ((y - cy) / ry) ** 2)));
    const bulge = 1.055 + 0.09 * Math.sin(Math.PI * Math.min(1, u * 1.1)) ** 0.8 - 0.06 * smoothstep(0.72, 1, u);
    const f = ell * bulge * (1 + 0.02 * Math.sin(th * 11 + phase));
    // Przy krawędziach przodu zasłona lekko wysunięta do przodu, jak kosmyki okalające policzki.
    const edge = Math.min(v, 1 - v) * thetaSpan;
    const forward = 0.012 * (1 - smoothstep(0, 0.5, edge)) * u;
    return [cx + rx * f * Math.sin(th), y, cz + rz * f * Math.cos(th) + forward];
  });

  // Prosta grzywka: dziewięć płaskich pasm na czole.
  const bangs = 9;
  for (let k = 0; k < bangs; k++) {
    const f = k / (bangs - 1);
    const th = (f - 0.5) * 1.05;
    const path: Vec3[] = [];
    const steps = 5;
    const phiEnd = 1.27 + 0.02 * Math.sin(k * 2.3);
    for (let s = 0; s < steps; s++) {
      const t = s / (steps - 1);
      path.push(onHead(head, th, 0.35 + (phiEnd - 0.35) * t, 1.06 + 0.035 * Math.sin(t * Math.PI)));
    }
    b.tube(path, (t) => [0.0092 * (1 - 0.2 * t), 0.0055 * (1 - 0.3 * t)], 6, [1, 0, 0]);
  }

  return b.build();
}
