import { ShuffleBag } from "./shuffleBag";

/** Parametry rytmu kroków gracza (wszystko w metrach i sekundach). */
export type StrideConfig = {
  /** Długość kroku (m): odległość przebyta między kolejnymi odgłosami. */
  walkStride: number;
  runStride: number;
  /** Prędkość (m/s) od której ruch uznajemy za bieg; chód gracza to 3,2, sprint 5,6. */
  runSpeed: number;
  /** Poniżej tej prędkości gracz stoi (nie ma kroków), np. gdy napiera na drzewo. */
  minSpeed: number;
  /** Przesunięcie większe niż to w jednej klatce (m) to teleportacja, nie chód. */
  teleportDistance: number;
  /** Ułamek kroku zaliczony od razu po ruszeniu: pierwszy krok słychać krótko po starcie. */
  startFraction: number;
  /** Najkrótszy odstęp między krokami (s): ogranicza częstotliwość przy skokach prędkości. */
  minInterval: number;
  /** Tyle czasu bez ruchu kasuje przebytą drogę (krótkie szarpnięcie nie liczy się jako zatrzymanie). */
  idleReset: number;
};

export const PLAYER_STRIDE: StrideConfig = {
  walkStride: 1.45,
  runStride: 2,
  runSpeed: 4.4,
  minSpeed: 0.35,
  teleportDistance: 4,
  startFraction: 0.6,
  minInterval: 0.22,
  idleReset: 0.12,
};

/** Subtelne zróżnicowanie każdego kroku. Wartości małe, żeby nie deformować próbek. */
export type StepVariation = {
  /** Zakres `playbackRate` (zmiana wysokości i tempa próbki). */
  rate: readonly [number, number];
  /** Losowa zmiana głośności: ±ułamek. */
  gainJitter: number;
  /** Mnożnik głośności przy biegu. */
  runGain: number;
  /** Losowa zmiana barwy: filtr dolnoprzepustowy pomnożony przez wartość z tego zakresu. */
  tone: readonly [number, number];
};

export const PLAYER_VARIATION: StepVariation = { rate: [0.96, 1.04], gainJitter: 0.08, runGain: 1.12, tone: [0.9, 1.1] };
/** Troll jest większy i cięższy: nieco niższe tempo próbek (bez przesady) i mniejszy rozrzut głośności. */
export const NPC_VARIATION: StepVariation = { rate: [0.9, 0.98], gainJitter: 0.06, runGain: 1, tone: [0.9, 1.1] };

export type StepEvent = {
  /** Numer próbki w puli (0-3 dziś; w diagnostyce pokazywany jako #1-#4). */
  sample: number;
  gain: number;
  rate: number;
  /** Mnożnik barwy (filtr dolnoprzepustowy). */
  tone: number;
  run: boolean;
};

/**
 * Dobór próbki i zmienności dla jednego odtwarzacza (gracz albo troll): własny worek losowania na pulę i własny generator,
 * więc losowania gracza i trolla są niezależne.
 */
export class StepVoicing {
  private readonly bags = new Map<string, ShuffleBag>();

  constructor(
    private readonly rng: () => number,
    private readonly variation: StepVariation,
  ) {}

  bag(pool: string, count: number): ShuffleBag {
    let bag = this.bags.get(pool);
    if (!bag || bag.count !== count) {
      bag = new ShuffleBag(count, this.rng);
      this.bags.set(pool, bag);
    }
    return bag;
  }

  next(pool: string, count: number, run: boolean): StepEvent {
    const v = this.variation;
    const sample = this.bag(pool, Math.max(1, count)).next();
    const span = (range: readonly [number, number]) => range[0] + (range[1] - range[0]) * this.rng();
    return {
      sample,
      gain: (1 + (this.rng() * 2 - 1) * v.gainJitter) * (run ? v.runGain : 1),
      rate: span(v.rate),
      tone: span(v.tone),
      run,
    };
  }
}

/**
 * Kroki gracza z przebytej drogi: akumulator odległości, a nie stały zegar. Każde zdarzenie przypada na przebyty odcinek,
 * więc bieg przyspiesza kroki, a stanie, obracanie kamery i napieranie na przeszkodę (brak zmiany pozycji) ich nie
 * wywołują. Wywołuj raz na klatkę z faktycznym przesunięciem; nie alokuje.
 */
export class FootstepScheduler {
  private travelled = 0;
  private moving = false;
  private idle = 0;
  private sinceStep = Infinity;
  private _running = false;

  constructor(readonly config: StrideConfig = PLAYER_STRIDE) {}

  get running(): boolean {
    return this._running;
  }

  get walking(): boolean {
    return this.moving;
  }

  reset(): void {
    this.travelled = 0;
    this.moving = false;
    this._running = false;
    this.idle = 0;
  }

  /** Zwraca true, gdy w tej klatce przypada krok (`running` mówi, czy bieg). `distance` to przesunięcie poziome w tej klatce. */
  update(distance: number, dt: number, frozen: boolean): boolean {
    const c = this.config;
    if (dt <= 0) return false;
    this.sinceStep += dt;
    if (frozen || distance > c.teleportDistance) {
      this.reset();
      return false;
    }
    const speed = distance / dt;
    if (speed < c.minSpeed) {
      this.idle += dt;
      if (this.idle >= c.idleReset) this.reset();
      this._running = false;
      return false;
    }
    this.idle = 0;
    if (!this.moving) {
      this.moving = true;
      this.travelled = c.startFraction * c.walkStride;
    }
    this._running = speed >= c.runSpeed;
    const stride = this._running ? c.runStride : c.walkStride;
    this.travelled += distance;
    if (this.travelled < stride) return false;
    if (this.sinceStep < c.minInterval) {
      this.travelled = Math.min(this.travelled, stride * 1.5);
      return false;
    }
    this.travelled -= stride;
    if (this.travelled >= stride) this.travelled = 0;
    this.sinceStep = 0;
    return true;
  }
}

// --- kroki trolla: dźwięk przestrzenny -------------------------------------------------------------------------------------

/** Charakterystyka dźwięku trolla (3D). Model tłumienia to `inverse` PannerNode, plus miękkie wygaszenie na końcu zasięgu. */
export const NPC_STEP_SOUND = {
  /** Do tej odległości (m) kroki są bez tłumienia. */
  refDistance: 3,
  rolloff: 1.2,
  /** Od tej odległości (m) dodatkowe płynne wygaszanie, a przy `cullDistance` nie powstają nowe źródła. */
  fadeStart: 28,
  cullDistance: 40,
  /** Dolnoprzepustowy filtr: Hz = base - slope * odległość (m), nie niżej niż min. */
  lowpass: { base: 14000, slope: 330, min: 1600 },
  /** Cięższe brzmienie: półka niskich tonów. */
  heavyShelf: { frequency: 240, gainDb: 3 },
  /** Wysokość źródła w świecie (m): stopy trolla tuż nad ziemią. */
  footHeight: 0.1,
  maxVoices: 3,
} as const;

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** Samo końcowe wygaszenie (1 do `fadeStart`, 0 przy `cullDistance`); tłumienie z odległości robi PannerNode. */
export function npcStepFade(distance: number, s: typeof NPC_STEP_SOUND = NPC_STEP_SOUND): number {
  return 1 - smoothstep(s.fadeStart, s.cullDistance, distance);
}

/** Wzmocnienie z odległości: model `inverse` Web Audio (jak PannerNode) razem z wygaszeniem końcowym. Zero poza `cullDistance`. */
export function npcStepGain(distance: number, s: typeof NPC_STEP_SOUND = NPC_STEP_SOUND): number {
  if (distance >= s.cullDistance) return 0;
  const d = Math.max(distance, s.refDistance);
  const inverse = s.refDistance / (s.refDistance + s.rolloff * (d - s.refDistance));
  return inverse * npcStepFade(distance, s);
}

export const npcStepAttenuationDb = (distance: number): number => 20 * Math.log10(Math.max(npcStepGain(distance), 1e-6));

export function npcStepLowpass(distance: number, s: typeof NPC_STEP_SOUND = NPC_STEP_SOUND): number {
  return Math.max(s.lowpass.min, s.lowpass.base - s.lowpass.slope * distance);
}
