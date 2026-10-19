/**
 * Syntetyczny zastępnik kroków po ściółce (szum z chrzęstem), używany, dopóki nie ma nagrania kroków.
 * To nie jest nagranie: zastępnik jest oznaczony w diagnostyce i znika, gdy w manifeście pojawi się `footsteps.leaves`.
 */
export const SYNTH_STEP_VARIANTS = 4;
const STEP_SECONDS = 0.3;

export function synthFootstep(sampleRate: number, rng: () => number): Float32Array {
  const n = Math.round(STEP_SECONDS * sampleRate);
  const out = new Float32Array(n);
  const attack = Math.max(1, Math.round(0.004 * sampleRate));
  const tau = 0.07 * sampleRate;
  let lowA = 0;
  let lowB = 0;
  const aHigh = Math.exp((-2 * Math.PI * 650) / sampleRate);
  const aLow = Math.exp((-2 * Math.PI * (3600 + rng() * 1800)) / sampleRate);
  for (let i = 0; i < n; i++) {
    const white = rng() * 2 - 1;
    lowA = (1 - aHigh) * white + aHigh * lowA;
    lowB = (1 - aLow) * white + aLow * lowB;
    const band = lowB - lowA;
    const env = Math.min(1, i / attack) * Math.exp(-i / tau);
    out[i] = band * env;
  }
  const crackles = 5 + Math.floor(rng() * 5);
  for (let k = 0; k < crackles; k++) {
    const at = Math.floor(rng() * 0.16 * sampleRate);
    const amp = (0.3 + rng() * 0.7) * (rng() < 0.5 ? -1 : 1);
    const len = Math.max(2, Math.round(0.003 * sampleRate));
    for (let j = 0; j < len && at + j < n; j++) out[at + j] += amp * Math.exp((-3 * j) / len) * (j % 2 === 0 ? 1 : -0.6);
  }
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  const scale = peak > 0 ? 0.55 / peak : 1;
  for (let i = 0; i < n; i++) out[i] *= scale;
  const fade = Math.round(0.02 * sampleRate);
  for (let i = 0; i < fade; i++) out[n - 1 - i] *= i / fade;
  return out;
}
