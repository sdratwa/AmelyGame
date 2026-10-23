import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * Geometria proceduralnej lampy naftowej (baśniowy stylizowany "hurricane lantern"), tylko dane siatek bez materiałów
 * i bez świateł. Jednostki w metrach, początek układu w szczycie uchwytu (tam chwyta dłoń), korpus zwisa w dół (-Y).
 * Wszystko ma niską liczbę wielokątów (16 segmentów obrotu), a części metalowe są scalone w jedną siatkę (1 draw call).
 *
 * Wymiana na model GLB: wystarczy podać własną `LanternVisualFactory` (patrz `visual.ts`); reszta systemu (światło, blask,
 * mocowanie, LOD, sieć) nie zależy od tego pliku.
 */
export const LANTERN_HEIGHT = 0.213;
/** Skala wizualna korpusu (lampa ma być czytelna na postaci dziecięcej, nie realistycznie mała). */
export const LANTERN_VISUAL_SCALE = 1.3;
/** Wysokość środka płomienia pod początkiem układu (m, przed skalą wizualną). */
export const FLAME_CENTER_Y = -0.12;
export const FLAME_BASE_Y = -0.142;
const SEGMENTS = 16;

export type LanternGeometries = {
  /** Metal: uchwyt, daszek, obejmy, zbiornik na naftę, stopka i knot, scalone w jedną siatkę. */
  body: THREE.BufferGeometry;
  /** Szklany klosz. */
  glass: THREE.BufferGeometry;
  /** Płomień (kropla), początek układu u podstawy knota. */
  flame: THREE.BufferGeometry;
  dispose(): void;
};

const lathe = (points: readonly [number, number][]) => new THREE.LatheGeometry(points.map(([x, y]) => new THREE.Vector2(x, y)), SEGMENTS);
const ring = (radius: number, height: number, y: number) => new THREE.CylinderGeometry(radius, radius, height, SEGMENTS).translate(0, y, 0);

export function createLanternGeometries(): LanternGeometries {
  const parts: THREE.BufferGeometry[] = [];

  // Uchwyt: półokrąg nad daszkiem (szczyt w y = 0), końce wchodzą w obrzeże daszka.
  parts.push(new THREE.TorusGeometry(0.05, 0.005, 6, 18, Math.PI).translate(0, -0.05, 0));
  // Daszek (stożek z kominkiem), idąc od dołu do góry, żeby normalne patrzyły na zewnątrz.
  parts.push(
    lathe([
      [0, -0.058],
      [0.05, -0.058],
      [0.05, -0.053],
      [0.018, -0.03],
      [0.012, -0.022],
      [0, -0.022],
    ]),
  );
  parts.push(ring(0.046, 0.008, -0.062));
  parts.push(ring(0.045, 0.008, -0.154));
  // Zbiornik na naftę: pękaty, niski.
  parts.push(
    lathe([
      [0, -0.205],
      [0.03, -0.205],
      [0.055, -0.195],
      [0.066, -0.18],
      [0.06, -0.165],
      [0.045, -0.158],
      [0, -0.158],
    ]),
  );
  parts.push(ring(0.04, 0.008, -0.209));
  // Uchwyt knota i sam knot.
  parts.push(new THREE.CylinderGeometry(0.012, 0.012, 0.016, 10).translate(0, -0.15, 0));
  parts.push(new THREE.BoxGeometry(0.008, 0.012, 0.003).translate(0, -0.14, 0));

  const body = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!body) throw new Error("Nie udało się scalić geometrii lampy");

  // Klosz: lekko pękaty szklany walec; idziemy od dołu do góry.
  const glass = lathe([
    [0.04, -0.15],
    [0.052, -0.14],
    [0.058, -0.11],
    [0.052, -0.078],
    [0.04, -0.066],
  ]);

  // Płomień: kropla z podstawą w y = 0.
  const flame = lathe([
    [0, 0],
    [0.009, 0.006],
    [0.012, 0.018],
    [0.008, 0.034],
    [0.002, 0.047],
    [0, 0.052],
  ]);

  return {
    body,
    glass,
    flame,
    dispose() {
      body.dispose();
      glass.dispose();
      flame.dispose();
    },
  };
}
