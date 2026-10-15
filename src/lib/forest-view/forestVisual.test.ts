import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEED,
  FAIRYTALE_CONFIG,
  MATERIAL_IDS,
  NATURAL_CONFIG,
  NEUTRAL_TUNING,
  ORIGINAL_CONFIG,
  PRESETS,
  PRESET_IDS,
  PaletteStore,
  TUNING_RANGES,
  atmosphereAt,
  buildForestWindow,
  buildGroundTexture,
  createFoliageUniforms,
  estimatePixel,
  gradeAlbedo,
  isModified,
  parsePreset,
  presetConfig,
  sanitizeTuning,
  sunElevationDeg,
  tintedFog,
  tuneMaterial,
  visualFromJson,
  visualToJson,
  REFERENCE_ALBEDO_SRGB,
  type VisualConfig,
} from ".";

const HOURS = [7, 12, 19];

const px = (id: string, hour: number, config: VisualConfig, surface: "top" | "sunSide" | "shadeSide" | "under", shadowed = false) =>
  estimatePixel(id, hour, config, { surface, shadowed });

describe("V2b: konfiguracja wizualna i presety", () => {
  it("ORIGINAL jest neutralny: nie zmienia kolorów, światła ani krzywej dnia względem V2a", () => {
    expect(ORIGINAL_CONFIG.tuning).toEqual(NEUTRAL_TUNING);
    expect(ORIGINAL_CONFIG.look.dayModel).toBe("v2a");
    expect(ORIGINAL_CONFIG.look.groundStyle).toBe("v2a");
    expect(ORIGINAL_CONFIG.look.shadowRadius).toBe(1);
    for (const id of MATERIAL_IDS) {
      const g = ORIGINAL_CONFIG.look.palette[id];
      expect(g.gain).toEqual([1, 1, 1]);
      expect(g.sat).toBe(1);
      expect(g.up).toBe(0);
      expect(g.variation).toBe(0);
      expect(g.tint).toBeUndefined();
    }
    for (const h of [0, 3, 6.5, 7, 12, 17.25, 19, 22.5]) expect(atmosphereAt(h, "v2a")).toEqual(atmosphereAt(h));
    const src = [0.4, 0.2, 0.05] as const;
    gradeAlbedo("bark_normaltree", src, ORIGINAL_CONFIG.look.palette.bark_normaltree, 1).forEach((v, i) => expect(v).toBeCloseTo(src[i], 12));
    const red = [0.386, 0.0086, 0.0091] as const;
    const swapped = gradeAlbedo("leaves_twistedtree", red, ORIGINAL_CONFIG.look.palette.leaves_twistedtree, 1);
    expect(swapped[0]).toBeCloseTo(red[1], 6);
    expect(swapped[1]).toBeCloseTo(red[0], 6);
  });

  it("presety są niezależnymi kopiami, a suwaki mają zakresy i walidację", () => {
    for (const id of PRESET_IDS) {
      const a = presetConfig(id);
      a.tuning.sun = 99;
      a.look.palette.leaves_pine.gain = [9, 9, 9];
      expect(PRESETS[id].tuning.sun).not.toBe(99);
      expect(PRESETS[id].look.palette.leaves_pine.gain).not.toEqual([9, 9, 9]);
      expect(isModified(presetConfig(id))).toBe(false);
      for (const [key, r] of Object.entries(TUNING_RANGES)) {
        const v = PRESETS[id].tuning[key as keyof typeof TUNING_RANGES];
        expect(v).toBeGreaterThanOrEqual(r.min);
        expect(v).toBeLessThanOrEqual(r.max);
      }
    }
    const s = sanitizeTuning({ exposure: 50, ambient: -3, shadow: Number.NaN, fogTint: "zielony" });
    expect(s.exposure).toBe(TUNING_RANGES.exposure.max);
    expect(s.ambient).toBe(0);
    expect(s.shadow).toBe(NEUTRAL_TUNING.shadow);
    expect(s.fogTint).toBe(NEUTRAL_TUNING.fogTint);
    expect(parsePreset("natural")).toBe("NATURAL");
    expect(parsePreset("x")).toBeNull();
    const modified = presetConfig("NATURAL");
    modified.tuning.exposure += 0.1;
    expect(isModified(modified)).toBe(true);
  });

  it("JSON konfiguracji ma stały format, wraca bez strat i odrzuca śmieci", () => {
    for (const id of PRESET_IDS) {
      const json = JSON.stringify(visualToJson(presetConfig(id), 19, "HIGH"));
      const back = visualFromJson(json);
      expect(back?.config).toEqual(presetConfig(id));
      expect(back?.hour).toBe(19);
    }
    const custom = presetConfig("FAIRYTALE");
    custom.tuning.fogTint = "#aabbcc";
    custom.tuning.greenSaturation = 0.7;
    const parsed = visualFromJson(JSON.stringify(visualToJson(custom, 7, "MEDIUM")));
    expect(parsed?.config.tuning.fogTint).toBe("#aabbcc");
    expect(parsed?.config.tuning.greenSaturation).toBe(0.7);
    expect(JSON.parse(JSON.stringify(visualToJson(custom, 7, "MEDIUM"))).modified).toBe(true);
    expect(visualFromJson("nie json")).toBeNull();
    expect(visualFromJson(JSON.stringify({ format: "inny" }))).toBeNull();
    const hostile = visualFromJson(JSON.stringify({ format: "forest-visual/1", preset: "NATURAL", tuning: { exposure: 1e9 }, look: { dayModel: "x", groundStyle: 5 }, hour: 31 }));
    expect(hostile?.config.tuning.exposure).toBe(TUNING_RANGES.exposure.max);
    expect(hostile?.config.look.dayModel).toBe("summer");
    expect(hostile?.config.look.groundStyle).toBe("natural");
    expect(hostile?.hour).toBe(7);
  });

  it("kolor mgły miesza się z kolorem pory dnia wg udziału", () => {
    const base = [0.2, 0.4, 0.6] as const;
    expect(tintedFog(base, { ...NEUTRAL_TUNING, fogTintAmount: 0 })).toEqual([...base]);
    const full = tintedFog(base, { ...NEUTRAL_TUNING, fogTint: "#ff0000", fogTintAmount: 1 });
    expect(full).toEqual([1, 0, 0]);
    const half = tintedFog(base, { ...NEUTRAL_TUNING, fogTint: "#ff0000", fogTintAmount: 0.5 });
    expect(half[0]).toBeCloseTo(0.6, 6);
  });
});

describe("V2b: oświetlenie, czytelność rano, w południe i wieczorem", () => {
  it("V2a było za ciemne: sosna w cieniu i pnie nie przekraczają kilku jednostek jasności (wartość odniesienia)", () => {
    expect(px("leaves_pine", 12, ORIGINAL_CONFIG, "shadeSide", true).luminance).toBeLessThan(10);
    expect(px("bark_normaltree", 12, ORIGINAL_CONFIG, "shadeSide", true).luminance).toBeLessThan(12);
    expect(px("leaves_pine", 7, ORIGINAL_CONFIG, "top").luminance).toBeLessThan(15);
    expect(px("leaves_pine", 19, ORIGINAL_CONFIG, "top").luminance).toBeLessThan(15);
  });

  it("NATURAL i FAIRYTALE: pnie czytelne w cieniu, sosny nie są czarne, nic się nie przepala (7:00, 12:00, 19:00)", () => {
    for (const config of [NATURAL_CONFIG, FAIRYTALE_CONFIG]) {
      for (const h of HOURS) {
        for (const id of ["bark_normaltree", "bark_twistedtree", "rocks"]) {
          const shade = px(id, h, config, "shadeSide", true).luminance;
          expect(shade, `${config.preset} ${id} ${h}h cień`).toBeGreaterThan(27);
          const lit = px(id, h, config, "sunSide").luminance;
          expect(lit / shade, `${config.preset} ${id} ${h}h kontrast`).toBeLessThan(3);
        }
        expect(px("leaves_pine", h, config, "top").luminance, `${config.preset} sosna góra ${h}h`).toBeGreaterThan(55);
        expect(px("leaves_pine", h, config, "sunSide").luminance, `${config.preset} sosna bok ${h}h`).toBeGreaterThan(75);
        expect(px("leaves_pine", h, config, "shadeSide", true).luminance, `${config.preset} sosna cień ${h}h`).toBeGreaterThan(32);
        expect(px("leaves_pine", h, config, "under", true).luminance, `${config.preset} sosna spód ${h}h`).toBeGreaterThan(12);
        for (const id of Object.keys(REFERENCE_ALBEDO_SRGB)) {
          for (const surface of ["top", "sunSide"] as const) {
            const p = px(id, h, config, surface);
            expect(Math.max(...p.srgb), `${config.preset} ${id} ${h}h ${surface} przepalenie`).toBeLessThan(235);
          }
        }
      }
    }
  });

  it("cienie są łagodniejsze niż w V2a: stosunek słońce/cień drzew spada wyraźnie", () => {
    const ratio = (c: VisualConfig, id: string, h: number) => px(id, h, c, "sunSide").luminance / Math.max(1, px(id, h, c, "shadeSide", true).luminance);
    for (const h of HOURS) {
      for (const id of ["bark_normaltree", "leaves_pine", "leaves_normaltree"]) {
        expect(ratio(NATURAL_CONFIG, id, h), `${id} ${h}h`).toBeLessThan(ratio(ORIGINAL_CONFIG, id, h) / 2.5);
      }
    }
    expect(NATURAL_CONFIG.tuning.shadow).toBeLessThan(1);
    expect(FAIRYTALE_CONFIG.tuning.shadow).toBeLessThan(NATURAL_CONFIG.tuning.shadow);
    expect(NATURAL_CONFIG.look.shadowRadius).toBeGreaterThan(ORIGINAL_CONFIG.look.shadowRadius);
  });

  it("jasność nie jest kupiona samym światłem: ekspozycja i światło otoczenia zostają w rozsądnych granicach", () => {
    for (const c of [NATURAL_CONFIG, FAIRYTALE_CONFIG]) {
      expect(c.tuning.exposure).toBeLessThanOrEqual(1.25);
      expect(c.tuning.ambient).toBeLessThanOrEqual(2);
      expect(c.tuning.sun).toBeLessThanOrEqual(1);
      const a = atmosphereAt(12, c.look.dayModel);
      const skyLum = (a.hemiSky[0] * 0.2126 + a.hemiSky[1] * 0.7152 + a.hemiSky[2] * 0.0722) ** 2.2;
      const ambientTop = a.hemiIntensity * c.tuning.ambient * skyLum;
      const sunTop = a.sunIntensity * c.tuning.sun * Math.sin((sunElevationDeg(12, c.look.dayModel) * Math.PI) / 180);
      expect(ambientTop / sunTop, `${c.preset} w południe światło otoczenia nie dominuje nad słońcem`).toBeLessThan(0.85);
    }
  });

  it("model letni: o 7:00, 12:00 i 19:00 słońce jest nad horyzontem, a V2a o 19:00 miało je pod horyzontem", () => {
    for (const h of HOURS) {
      expect(sunElevationDeg(h, "summer")).toBeGreaterThan(15);
      expect(atmosphereAt(h, "summer").daylight).toBe(1);
    }
    expect(sunElevationDeg(19, "v2a")).toBeLessThan(0);
    expect(atmosphereAt(19, "v2a").daylight).toBe(0);
    expect(sunElevationDeg(12, "summer")).toBeGreaterThan(50);
    expect(atmosphereAt(12, "summer").sunIntensity).toBeGreaterThan(atmosphereAt(19, "summer").sunIntensity);
    expect(atmosphereAt(19, "summer").sunColor[2]).toBeLessThan(atmosphereAt(12, "summer").sunColor[2] - 0.2);
  });

  it("model letni jest ciągły przez całą dobę i zawija się o północy", () => {
    let prev = atmosphereAt(0, "summer");
    for (let h = 0.25; h <= 24; h += 0.25) {
      const a = atmosphereAt(h, "summer");
      const len = Math.hypot(...a.sunDir);
      expect(len).toBeCloseTo(1, 6);
      expect(Math.abs(a.sunIntensity - prev.sunIntensity)).toBeLessThan(0.5);
      expect(Math.abs(a.hemiIntensity - prev.hemiIntensity)).toBeLessThan(0.25);
      expect(a.sunDir[1]).toBeGreaterThan(0);
      prev = a;
    }
    expect(atmosphereAt(24, "summer").hour).toBe(0);
  });
});

describe("V2b: paleta roślinności", () => {
  const sat = (rgb: readonly number[]) => (Math.max(...rgb) - Math.min(...rgb)) / Math.max(...rgb, 1e-6);

  it("nasycona zieleń krzewu i starych drzew jest uspokojona względem V2a", () => {
    for (const config of [NATURAL_CONFIG, FAIRYTALE_CONFIG]) {
      const orig = px("leaves_twistedtree", 12, ORIGINAL_CONFIG, "top");
      const now = px("leaves_twistedtree", 12, config, "top");
      expect(sat(now.srgb), config.preset).toBeLessThan(sat(orig.srgb) * 0.7);
      expect(now.srgb[1], `${config.preset} zieleń nadal dominuje`).toBeGreaterThan(now.srgb[0]);
      const grass = px("grass", 12, config, "top");
      expect(sat(grass.srgb)).toBeLessThan(sat(px("grass", 12, ORIGINAL_CONFIG, "top").srgb));
    }
  });

  it("sosny, drzewa liściaste i krzewy różnią się jasnością i odcieniem", () => {
    for (const config of [NATURAL_CONFIG, FAIRYTALE_CONFIG]) {
      const pine = px("leaves_pine", 12, config, "sunSide");
      const broadleaf = px("leaves_normaltree", 12, config, "sunSide");
      const bush = px("leaves_twistedtree", 12, config, "sunSide");
      expect(broadleaf.luminance).toBeGreaterThan(pine.luminance * 1.15);
      expect(bush.luminance).toBeLessThan(broadleaf.luminance);
      expect(bush.luminance).toBeGreaterThan(pine.luminance);
      expect(pine.srgb[2] / pine.srgb[1]).toBeGreaterThan(broadleaf.srgb[2] / broadleaf.srgb[1] + 0.1);
      expect(broadleaf.srgb[0] / broadleaf.srgb[1]).toBeGreaterThan(pine.srgb[0] / pine.srgb[1]);
    }
  });

  it("suwak nasycenia zieleni dotyka tylko zielonych pikseli (kwiaty i kora zostają)", () => {
    const palette = NATURAL_CONFIG.look.palette;
    const flower = [0.7, 0.2, 0.3] as const;
    const bark = [0.3, 0.17, 0.1] as const;
    const green = [0.1, 0.35, 0.05] as const;
    for (const id of ["flowers", "bark_normaltree"]) {
      const c = id === "flowers" ? flower : bark;
      expect(gradeAlbedo(id, c, palette[id], 0)).toEqual(gradeAlbedo(id, c, palette[id], 1.5));
    }
    const grey = gradeAlbedo("leaves", green, palette.leaves, 0);
    expect(Math.max(...grey) - Math.min(...grey)).toBeLessThan(0.05);
    const vivid = gradeAlbedo("leaves", green, palette.leaves, 1.5);
    expect(vivid[1] - vivid[0]).toBeGreaterThan(grey[1] - grey[0]);
  });

  it("paleta nie zmienia ID modeli ani materiałów z manifestu", () => {
    for (const id of MATERIAL_IDS) expect(NATURAL_CONFIG.look.palette[id], id).toBeDefined();
    expect(Object.keys(NATURAL_CONFIG.look.palette).sort()).toEqual([...MATERIAL_IDS].sort());
    expect(Object.keys(FAIRYTALE_CONFIG.look.palette).sort()).toEqual([...MATERIAL_IDS].sort());
  });
});

describe("V2b: shadery korekty materiałów", () => {
  const fakeShader = () => ({
    uniforms: {} as Record<string, unknown>,
    vertexShader: "#include <common>\n#include <begin_vertex>\n",
    fragmentShader: "#include <common>\n#include <map_fragment>\n#include <normal_fragment_maps>\n",
  });
  const compile = (id: string, store = new PaletteStore()) => {
    const material = new THREE.MeshStandardMaterial({ name: id });
    material.userData.assetMaterialId = id;
    tuneMaterial(material, createFoliageUniforms(), store);
    const shader = fakeShader();
    (material.onBeforeCompile as (s: unknown, r: unknown) => void)(shader, {});
    return { material, shader, store };
  };

  it("liście dostają pochylenie normalnych, a kora i skały nie", () => {
    expect(compile("leaves_pine").shader.fragmentShader).toContain("uUp");
    expect(compile("leaves_pine").shader.fragmentShader).toContain("normal = normalize(mix(normal");
    expect(compile("bark_normaltree").shader.fragmentShader).not.toContain("normal = normalize(mix(normal");
    expect(compile("rocks").shader.fragmentShader).toContain("uGain");
  });

  it("zamiana kanałów (czerwone liście) jest tylko w materiale starych drzew", () => {
    expect(compile("leaves_twistedtree").shader.fragmentShader).toContain("grC.grb");
    expect(compile("leaves_pine").shader.fragmentShader).not.toContain("grC.grb");
    expect(compile("bark_twistedtree").shader.fragmentShader).not.toContain("grC.grb");
  });

  it("wiatr i przyciemnienie nasady zostają w materiałach roślin, a nieznane materiały nie są ruszane", () => {
    const grass = compile("grass");
    expect(grass.shader.vertexShader).toContain("transformed.x += fS * fW");
    expect(grass.shader.fragmentShader).toContain("smoothstep(0.0, 0.40, vForestH)");
    expect(compile("bark_normaltree").shader.vertexShader).not.toContain("transformed.x += fS * fW");
    const other = new THREE.MeshStandardMaterial({ name: "nieznany" });
    tuneMaterial(other, createFoliageUniforms());
    expect(other.onBeforeCompile.toString()).toBe(new THREE.MeshStandardMaterial().onBeforeCompile.toString());
  });

  it("zmiana presetu aktualizuje uniformy w miejscu (bez nowych materiałów i rekompilacji)", () => {
    const store = new PaletteStore();
    const { shader } = compile("leaves_pine", store);
    const uniforms = shader.uniforms as Record<string, { value: unknown }>;
    const gain = uniforms.uGain;
    const tintAmount = uniforms.uTintAmt;
    expect(tintAmount.value).toBe(0);
    store.setPalette(NATURAL_CONFIG.look.palette, NATURAL_CONFIG.tuning.greenSaturation, NATURAL_CONFIG.look.groundDetail);
    expect(store.get("leaves_pine").uGain).toBe(gain);
    expect(tintAmount.value).toBe(1);
    expect((uniforms.uGreenSat as { value: number }).value).toBeCloseTo(NATURAL_CONFIG.tuning.greenSaturation, 6);
    store.setPalette(ORIGINAL_CONFIG.look.palette, 1, 0);
    expect(tintAmount.value).toBe(0);
    expect(store.groundDetail.value).toBe(0);
    const material = compile("leaves_pine", store).material;
    expect(material.customProgramCacheKey()).toBe("forest2:leaves_pine");
  });
});

describe("V2b: grunt (ściółka, ścieżki, brak zielonego dywanu)", () => {
  const w = buildForestWindow({ seed: DEFAULT_SEED });
  const base = { forest: w.forest, bounds: w.windowBounds, objects: w.objects, size: 256 };
  const v2a = buildGroundTexture({ ...base, style: "v2a" });
  const natural = buildGroundTexture({ ...base, style: "natural" });

  const stats = (tex: typeof v2a) => {
    let green = 0;
    let brown = 0;
    let n = 0;
    const path: number[] = [];
    const meadow: number[] = [];
    const lumList: number[] = [];
    const ratios: number[] = [];
    for (let j = 0; j < tex.size; j++) {
      for (let i = 0; i < tex.size; i++) {
        const k = (j * tex.size + i) * 4;
        const [r, g, b] = [tex.data[k], tex.data[k + 1], tex.data[k + 2]];
        const x = w.windowBounds.minX + (i + 0.5) * tex.metersPerPixel;
        const z = w.windowBounds.minZ + (j + 0.5) * tex.metersPerPixel;
        const gap = w.forest.geometry.trailGap(x, z);
        const water = w.forest.geometry.waterGap(x, z);
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if (water > 6 && gap > 0.5) {
          n++;
          lumList.push(lum);
          ratios.push(r / g);
          if (g > r * 1.1 && g > b * 1.35) green++;
          else brown++;
        }
        if (gap < -0.3) path.push(lum);
        else if (gap > 3 && water > 6) meadow.push(lum);
      }
    }
    const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
    const m = mean(lumList);
    const sd = Math.sqrt(mean(lumList.map((v) => (v - m) ** 2)));
    const rm = mean(ratios);
    const hueSpread = Math.sqrt(mean(ratios.map((v) => (v - rm) ** 2)));
    return { hueSpread, greenShare: green / n, brownShare: brown / n, pathLum: mean(path), meadowLum: mean(meadow), sd, pathN: path.length };
  };

  it("styl natural jest deterministyczny i różni się od V2a", () => {
    const again = buildGroundTexture({ ...base, style: "natural" });
    expect(Buffer.from(natural.data).equals(Buffer.from(again.data))).toBe(true);
    expect(Buffer.from(natural.data).equals(Buffer.from(v2a.data))).toBe(false);
    expect(buildGroundTexture(base).data).toEqual(v2a.data);
    for (let k = 3; k < natural.data.length; k += 4 * 997) expect(natural.data[k]).toBe(255);
  });

  it("zielony dywan zastąpiony płatami ściółki i ziemi", () => {
    const a = stats(v2a);
    const b = stats(natural);
    expect(b.greenShare).toBeLessThan(a.greenShare * 0.6);
    expect(b.greenShare, "las nadal ma sporo trawy").toBeGreaterThan(0.15);
    expect(b.brownShare).toBeGreaterThan(a.brownShare);
    expect(b.sd).toBeGreaterThan(7);
    expect(b.hueSpread).toBeGreaterThan(a.hueSpread * 1.2);
  });

  it("ścieżka jest wyraźnie jaśniejsza od otoczenia", () => {
    const b = stats(natural);
    expect(b.pathN).toBeGreaterThan(200);
    expect(b.pathLum - b.meadowLum).toBeGreaterThan(25);
  });
});
