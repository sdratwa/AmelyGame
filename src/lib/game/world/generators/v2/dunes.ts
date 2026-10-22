import { streamSeed } from "../../../core/rng";
import { valueNoise2 } from "../../noise";
import { makeField, type Terrain } from "../../terrain";
import type { ForestGeometry } from "./geometry";
import type { ProDuneTuning } from "./pro";

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const smooth = (t: number) => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};

/**
 * Wydmy pustyni trybu Pro (tylko `createForest` z `pro`): niskie, wydłużone grzbiety dodawane do wysokości terenu.
 * Wysokość jest czystą funkcją (seed, x, z), więc sektory i okna dają ten sam wynik. Amplituda jest ważona udziałem ćwiartki C
 * i wygaszana przy rzece, ścieżkach (w tym drodze z brukiem) oraz obszarach wolnych (start, lądowiska mostu), żeby nie ruszać
 * zadań i przejść. Poza ćwiartką C przesunięcie wynosi dokładnie 0, więc reszta lasu ma wysokości bazowe.
 */
export function createDuneOffset(geometry: ForestGeometry, seed: number, t: ProDuneTuning): (x: number, z: number) => number {
  const sa = streamSeed(seed, "forest.dunes.a") | 0;
  const sb = streamSeed(seed, "forest.dunes.b") | 0;
  const scratch = new Float64Array(4);
  return (x, z) => {
    const q = geometry.quadrantWeights(x, z, scratch);
    if (!q) return 0;
    const w = smooth((q[2] - 0.25) / 0.7);
    if (w <= 0) return 0;
    let fade = smooth((geometry.riverGapProxy(x, z) - t.riverClear) / t.riverRamp);
    if (fade <= 0) return 0;
    const trail = geometry.trailGap(x, z);
    if (trail < t.trailClear + t.trailRamp) fade *= smooth((trail - t.trailClear) / t.trailRamp);
    for (const c of geometry.keepClear) {
      const d = Math.sqrt((x - c.x) ** 2 + (z - c.z) ** 2) - c.r;
      if (d < t.clearRamp) fade *= smooth(d / t.clearRamp);
    }
    if (fade <= 0) return 0;
    // Grzbiety: 1 - |2n - 1| ma ostre szczyty i szerokie, łagodne doliny; rozciągnięcie wzdłuż osi z daje wydłużone wydmy.
    const warp = (valueNoise2(sb, x / 60, z / 60) - 0.5) * t.wavelength * 0.8;
    const n1 = valueNoise2(sa, (x + warp) / t.wavelength, z / (t.wavelength * t.stretch));
    const ridge = 1 - Math.abs(n1 * 2 - 1) - 0.5;
    const n2 = valueNoise2(sb, x / (t.wavelength * 0.45), z / (t.wavelength * 0.45 * t.stretch)) - 0.5;
    return t.amplitude * w * fade * (ridge * 0.8 + n2 * 0.4);
  };
}

/** Opakowuje teren: baza + wydmy; gradient, normalna i nachylenie wyliczane z nowej wysokości. */
export function withDunes(base: Terrain, geometry: ForestGeometry, seed: number, t: ProDuneTuning): Terrain {
  const offset = createDuneOffset(geometry, seed, t);
  const field = makeField((x, z) => base.height(x, z) + offset(x, z));
  return {
    seed: base.seed,
    version: base.version,
    modifiers: base.modifiers,
    ...field,
  };
}
