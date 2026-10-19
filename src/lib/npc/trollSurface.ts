/**
 * Powierzchnia trolla: klasyfikacja tekseli atlasu i wypiekanie mapy chropowatości. Czysta logika bez Three.js, żeby dało się ją
 * testować w Node i uruchamiać na prawdziwym atlasie.
 *
 * Źródło problemu: model ma jeden materiał i jeden atlas (kolor, normalne, metaliczność/chropowatość), a mapa MR z generatora
 * (Tripo) jest prawie płaska: chropowatość ok. 0,3 (lakier/plastik) na ok. 92% tekseli, a w oczach i w pustych polach między
 * wyspami UV spada do 0. Chropowatość nie rozróżnia skóry, brody ani nosa, więc rozróżniamy je po kolorze albedo.
 */

export type TexelClass = "skin" | "hair" | "nose" | "eye" | "accessory" | "gap";

/** Docelowa chropowatość (GGX) każdej klasy. Punkt wyjścia: wartości z zadania, do strojenia po obejrzeniu w grze. */
export const TROLL_ROUGHNESS: Readonly<Record<TexelClass, number>> = {
  skin: 0.85,
  hair: 0.95,
  nose: 0.7,
  eye: 0.7,
  accessory: 0.8,
  gap: 0.85,
};

/** Chropowatość z mapy MR poniżej tej wartości oznacza oko albo puste pole atlasu (oba dostają łagodny połysk, nigdy lustro). */
export const MIRROR_ROUGHNESS_BELOW = 0.2;
/** Czerń albedo poniżej tej jasności to puste pole między wyspami UV (nigdy nie jest próbkowane poza mipmapami i filtrowaniem krawędzi). */
export const GAP_LUMA_BELOW = 10;

export type Pixels = { width: number; height: number; /** RGBA (4 bajty na teksel), sRGB dla koloru. */ data: Uint8ClampedArray | Uint8Array };

export type TexelClassCounts = Record<TexelClass, number>;

export const emptyCounts = (): TexelClassCounts => ({ skin: 0, hair: 0, nose: 0, eye: 0, accessory: 0, gap: 0 });

function hsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max / 255 };
}

/** Klasa tekselu z albedo (sRGB 0-255) i chropowatości z oryginalnej mapy MR (0-1). */
export function classifyTexel(r: number, g: number, b: number, mrRoughness: number): TexelClass {
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (luma < GAP_LUMA_BELOW) return "gap";
  if (mrRoughness < MIRROR_ROUGHNESS_BELOW) return "eye";
  const { h, s, v } = hsv(r, g, b);
  const warm = h >= 340 || h < 25;
  if (warm && s > 0.72 && v > 0.45) return "accessory";
  if (warm && h >= 340 && s > 0.2) return "nose";
  if (h < 12 && s > 0.3 && v > 0.55) return "nose";
  if (s < 0.24 && v > 0.35) return "hair";
  if (h >= 70 && h <= 240) return "hair";
  return "skin";
}

export type BakedRoughness = {
  /** Chropowatość 0-255, jeden bajt na teksel, `size` x `size`. */
  data: Uint8Array;
  size: number;
  /** Udział klas w teksela źródła (bez pustych pól). */
  share: Record<Exclude<TexelClass, "gap">, number>;
  counts: TexelClassCounts;
};

/**
 * Buduje mapę chropowatości z atlasu koloru i oryginalnej mapy MR (kanał G, jak w glTF). Wynik ma `size` x `size`: każdy teksel to
 * średnia z bloku źródła, potem jedno rozmycie 3x3, żeby granice klas nie dawały ostrych skoków połysku.
 */
export function bakeRoughness(base: Pixels, mr: Pixels, size = 1024, table: Readonly<Record<TexelClass, number>> = TROLL_ROUGHNESS): BakedRoughness {
  if (base.width !== mr.width || base.height !== mr.height) throw new Error("Atlas koloru i mapa MR mają różne rozmiary.");
  if (base.width % size !== 0 || base.height !== base.width) throw new Error(`Rozmiar atlasu ${base.width}x${base.height} nie dzieli się przez ${size}.`);
  const block = base.width / size;
  const counts = emptyCounts();
  const coarse = new Float32Array(size * size);
  const w = base.width;
  for (let by = 0; by < size; by++) {
    for (let bx = 0; bx < size; bx++) {
      let sum = 0;
      for (let y = 0; y < block; y++) {
        for (let x = 0; x < block; x++) {
          const i = ((by * block + y) * w + bx * block + x) * 4;
          const klass = classifyTexel(base.data[i], base.data[i + 1], base.data[i + 2], mr.data[i + 1] / 255);
          counts[klass]++;
          sum += table[klass];
        }
      }
      coarse[by * size + bx] = sum / (block * block);
    }
  }
  const data = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
          sum += coarse[yy * size + xx];
          n++;
        }
      }
      data[y * size + x] = Math.round((sum / n) * 255);
    }
  }
  const used = counts.skin + counts.hair + counts.nose + counts.eye + counts.accessory || 1;
  const share = { skin: counts.skin / used, hair: counts.hair / used, nose: counts.nose / used, eye: counts.eye / used, accessory: counts.accessory / used };
  return { data, size, share, counts };
}
