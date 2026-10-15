import * as THREE from "three";
import type { MaterialGrade } from "./visual";

/**
 * Korekta koloru materiałów w shaderze (V2b). Każdy materiał ma własny zestaw uniformów; zmiana presetu tylko
 * aktualizuje ich wartości, więc nie ma przeładowania modeli ani rekompilacji shaderów. Zestaw neutralny (gain 1,
 * sat 1, tint 0, up 0, variation 0) daje dokładnie kolory z V2a.
 */
export type GradeUniforms = {
  uGain: { value: THREE.Vector3 };
  uSat: { value: number };
  uUp: { value: number };
  uTint: { value: THREE.Vector3 };
  uTintAmt: { value: number };
  uRefLum: { value: number };
  uVar: { value: number };
};

export class PaletteStore {
  /** Wspólne nasycenie zieleni (suwak panelu). */
  readonly greenSat = { value: 1 };
  /** Amplituda szumu szczegółu gruntu. */
  readonly groundDetail = { value: 0 };
  private readonly byId = new Map<string, GradeUniforms>();
  private palette: Record<string, MaterialGrade> = {};

  get(id: string): GradeUniforms {
    let u = this.byId.get(id);
    if (!u) {
      u = {
        uGain: { value: new THREE.Vector3(1, 1, 1) },
        uSat: { value: 1 },
        uUp: { value: 0 },
        uTint: { value: new THREE.Vector3(1, 1, 1) },
        uTintAmt: { value: 0 },
        uRefLum: { value: 1 },
        uVar: { value: 0 },
      };
      this.byId.set(id, u);
      const g = this.palette[id];
      if (g) assign(u, g);
    }
    return u;
  }

  setPalette(palette: Record<string, MaterialGrade>, greenSaturation: number, groundDetail: number): void {
    this.palette = palette;
    this.greenSat.value = greenSaturation;
    this.groundDetail.value = groundDetail;
    for (const [id, u] of this.byId) {
      const g = palette[id];
      if (g) assign(u, g);
    }
  }
}

function assign(u: GradeUniforms, g: MaterialGrade): void {
  u.uGain.value.set(g.gain[0], g.gain[1], g.gain[2]);
  u.uSat.value = g.sat;
  u.uUp.value = g.up;
  u.uVar.value = g.variation;
  if (g.tint) {
    u.uTint.value.set(g.tint.color[0], g.tint.color[1], g.tint.color[2]);
    u.uTintAmt.value = g.tint.amount;
    u.uRefLum.value = g.tint.refLum;
  } else {
    u.uTintAmt.value = 0;
    u.uRefLum.value = 1;
  }
}

export const GRADE_UNIFORM_DECL = /* glsl */ `
uniform vec3 uGain;
uniform float uSat;
uniform float uUp;
uniform vec3 uTint;
uniform float uTintAmt;
uniform float uRefLum;
uniform float uVar;
uniform float uGreenSat;
varying float vGrPhase;
`;

export const NOISE_GLSL = /* glsl */ `
float grHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float grNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(grHash(i), grHash(i + vec2(1.0, 0.0)), f.x), mix(grHash(i + vec2(0.0, 1.0)), grHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

export type GradeShaderOptions = {
  /** Zamiana kanałów R i G (czerwone liście -> zielone), jak w V2a. */
  swap: boolean;
  /** Pochylanie normalnych ku górze i zmienność wzoru na kartach liści. */
  foliage: boolean;
};

/** Fragment shadera: korekta albedo po `map_fragment`. Kolejność: zamiana kanałów, tint, nasycenie, mnożnik, zmienność. */
export function gradeFragment(options: GradeShaderOptions): string {
  return /* glsl */ `
  {
    vec3 grC = diffuseColor.rgb;
    float grL0 = dot(grC, vec3(0.2126, 0.7152, 0.0722));
    ${options.swap ? "grC = grC.grb;" : ""}
    grC = mix(grC, uTint * (grL0 / max(uRefLum, 0.0001)), uTintAmt);
    float grL = dot(grC, vec3(0.2126, 0.7152, 0.0722));
    float grG = clamp((grC.g - max(grC.r, grC.b)) / max(grL, 0.02) * 2.0, 0.0, 1.0);
    float grS = uSat * mix(1.0, uGreenSat, grG);
    grC = mix(vec3(grL), grC, grS) * uGain;
    ${
      options.foliage
        ? `#ifdef USE_MAP
    float grN = grNoise(vMapUv * 16.0 + vGrPhase * 17.0) - 0.5;
    #else
    float grN = 0.0;
    #endif
    grC *= 1.0 + uVar * (grN * 1.4 + (vGrPhase - 0.5) * 0.9);`
        : "grC *= 1.0 + uVar * (vGrPhase - 0.5) * 0.9;"
    }
    diffuseColor.rgb = grC;
  }`;
}

/** Fragment shadera: pochylenie normalnej ku górze (światło półsfery i słońca na kartach liści). */
export const NORMAL_UP_FRAGMENT = /* glsl */ `
  normal = normalize(mix(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz), uUp));`;

/** Zmiana koloru wierzchołka (faza wg pozycji instancji) wstrzykiwana do `begin_vertex`. */
export const PHASE_VERTEX = /* glsl */ `
  #ifdef USE_INSTANCING
    vGrPhase = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
  #else
    vGrPhase = 0.5;
  #endif`;

/** Szum szczegółu gruntu (współrzędne świata), wygaszany z odległością, żeby nie migotał. Wejście: `grC`, `uDetail`. */
export const GROUND_DETAIL_FRAGMENT = /* glsl */ `
  {
    float gdDist = length(vViewPosition);
    float gdA = grNoise(vGroundXZ * 3.1);
    float gdB = grNoise(vGroundXZ * 9.0 + 7.3) * (1.0 - smoothstep(14.0, 46.0, gdDist));
    float gdC = grNoise(vGroundXZ * 27.0 + 3.1) * (1.0 - smoothstep(5.0, 20.0, gdDist));
    float gdN = gdA * 0.5 + gdB * 0.3 + gdC * 0.2;
    float gdW = grNoise(vGroundXZ * 0.45 + 11.0);
    vec3 gdWarm = mix(vec3(1.05, 1.0, 0.92), vec3(0.95, 1.0, 1.06), gdW);
    diffuseColor.rgb *= (1.0 + uDetail * (gdN - 0.5) * 2.0) * mix(vec3(1.0), gdWarm, clamp(uDetail * 3.0, 0.0, 1.0));
  }`;
