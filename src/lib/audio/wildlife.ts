import { birdActivity, birdLoudness } from "./mix";

export const BIRD_IDS = ["bird.cockatoo", "bird.jungle", "bird.screech"] as const;
export type BirdId = (typeof BIRD_IDS)[number];

export type Range = readonly [number, number];

export type WildlifeConfig = {
  /** Podstawowa przerwa między nawoływaniami (s), przeliczana na aktywność pory dnia. */
  gap: Range;
  /** Rozrzut przerwy: mnożnik z tego zakresu. */
  gapJitter: Range;
  /** Szansa na szybką odpowiedź (kolejne nawoływanie po krótkiej przerwie) i jej przerwa (s). */
  clusterChance: number;
  clusterGap: Range;
  /** Najwyżej tyle pojedynczych efektów naraz; gdy limit zajęty, ponawiamy próbę po `retryGap` (s). */
  maxConcurrent: number;
  retryGap: Range;
  /** Odległość źródła od gracza (m). */
  distance: Range;
  /** Wysokość źródła nad poziomem uszu gracza (m): ptaki siedzą w koronach. */
  height: Range;
  /** Najmniejsza różnica kierunku względem poprzedniego nawoływania (rad). */
  minBearingSeparation: number;
  /** Zmiana wysokości tonu: współczynnik prędkości odtwarzania 1 +- pitch. */
  pitch: number;
  gain: Range;
  /** Podczas dialogu: mnożnik częstości i głośności. */
  dialogRate: number;
  dialogGain: number;
};

export const DEFAULT_WILDLIFE_CONFIG: WildlifeConfig = {
  gap: [12, 35],
  gapJitter: [0.85, 1.15],
  clusterChance: 0.12,
  clusterGap: [4, 9],
  maxConcurrent: 2,
  retryGap: [2, 5],
  distance: [15, 60],
  height: [3, 14],
  minBearingSeparation: (55 * Math.PI) / 180,
  pitch: 0.06,
  gain: [0.55, 1],
  dialogRate: 0.25,
  dialogGain: 0.6,
};

export type BirdEvent = {
  sound: BirdId;
  gain: number;
  rate: number;
  /** Kierunek źródła (rad) względem świata, nie względem kamery: obrót gracza zmienia jego słyszalną stronę. */
  bearing: number;
  distance: number;
  height: number;
};

export type WildlifeTick = { hour: number; dialog: boolean; activeEffects: number };

const lerp = (r: Range, u: number) => r[0] + (r[1] - r[0]) * u;

const angleDiff = (a: number, b: number) => {
  const d = Math.abs(a - b) % (Math.PI * 2);
  return d > Math.PI ? Math.PI * 2 - d : d;
};

/**
 * Losuje pojedyncze nawoływania ptaków. Zegarem jest "praca": licznik maleje z tempem równym aktywności pory dnia,
 * więc rano zdarzenia są częstsze, wieczorem rzadsze, a w nocy licznik stoi i jest zerowany (brak dziennych ptaków).
 * Losowość pochodzi z wstrzykniętego generatora i jest niezależna od seeda świata.
 */
export class WildlifeScheduler {
  private remaining: number | null = null;
  private lastSound: BirdId | null = null;
  private lastBearing: number | null = null;

  constructor(
    private readonly rng: () => number,
    readonly config: WildlifeConfig = DEFAULT_WILDLIFE_CONFIG,
  ) {}

  get pending(): number | null {
    return this.remaining;
  }

  reset(): void {
    this.remaining = null;
  }

  tick(dt: number, state: WildlifeTick): BirdEvent | null {
    const base = birdActivity(state.hour);
    if (base < 0.03) {
      this.remaining = null;
      return null;
    }
    const activity = base * (state.dialog ? this.config.dialogRate : 1);
    if (this.remaining === null) this.remaining = this.drawGap();
    this.remaining -= Math.max(0, dt) * activity;
    if (this.remaining > 0) return null;
    if (state.activeEffects >= this.config.maxConcurrent) {
      this.remaining = lerp(this.config.retryGap, this.rng());
      return null;
    }
    this.remaining = null;
    return this.makeEvent(state);
  }

  private drawGap(): number {
    if (this.rng() < this.config.clusterChance) return lerp(this.config.clusterGap, this.rng());
    return lerp(this.config.gap, this.rng()) * lerp(this.config.gapJitter, this.rng());
  }

  private pickSound(): BirdId {
    const pool = BIRD_IDS.filter((id) => id !== this.lastSound);
    const choices = pool.length > 0 ? pool : BIRD_IDS;
    const sound = choices[Math.min(choices.length - 1, Math.floor(this.rng() * choices.length))];
    this.lastSound = sound;
    return sound;
  }

  private pickBearing(): number {
    let bearing = this.rng() * Math.PI * 2;
    for (let i = 0; i < 8 && this.lastBearing !== null; i++) {
      if (angleDiff(bearing, this.lastBearing) >= this.config.minBearingSeparation) break;
      bearing = this.rng() * Math.PI * 2;
    }
    this.lastBearing = bearing;
    return bearing;
  }

  private makeEvent(state: WildlifeTick): BirdEvent {
    const c = this.config;
    return {
      sound: this.pickSound(),
      gain: lerp(c.gain, this.rng()) * birdLoudness(state.hour) * (state.dialog ? c.dialogGain : 1),
      rate: 1 + (this.rng() * 2 - 1) * c.pitch,
      bearing: this.pickBearing(),
      distance: c.distance[0] + (c.distance[1] - c.distance[0]) * Math.pow(this.rng(), 0.8),
      height: lerp(c.height, this.rng()),
    };
  }
}
