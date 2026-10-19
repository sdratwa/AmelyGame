export type FootstepConfig = {
  /** Długość kroku (m): odległość przebyta między kolejnymi odgłosami. */
  walkStride: number;
  runStride: number;
  /** Prędkość (m/s) od której ruch uznajemy za bieg; chód gracza to 3,2, sprint 5,6. */
  runSpeed: number;
  /** Poniżej tej prędkości gracz stoi (nie ma kroków). */
  minSpeed: number;
  /** Przesunięcie większe niż to w jednej próbce (m) to teleportacja, nie chód. */
  teleportDistance: number;
  /** Ułamek kroku zaliczony od razu po ruszeniu: pierwszy krok słychać krótko po starcie. */
  startFraction: number;
  gain: readonly [number, number];
  runGain: number;
  pitch: number;
  /** Najwyżej tyle jednoczesnych kroków (ogon poprzedniego nakłada się na kolejny). */
  maxVoices: number;
};

export const DEFAULT_FOOTSTEP_CONFIG: FootstepConfig = {
  walkStride: 1.35,
  runStride: 1.75,
  runSpeed: 4.4,
  minSpeed: 0.35,
  teleportDistance: 4,
  startFraction: 0.6,
  gain: [0.7, 1],
  runGain: 1.15,
  pitch: 0.08,
  maxVoices: 3,
};

export type FootstepEvent = { variant: number; gain: number; rate: number; run: boolean; lowpass: number };

export type MotionSample = {
  /** Przesunięcie poziome od poprzedniej próbki (m) i czas (s). */
  distance: number;
  dt: number;
  /** Ruch jest zablokowany (dialog, okno, pauza): zero kroków i reset kroku. */
  frozen: boolean;
};

/**
 * Kroki zależne od rzeczywistego przemieszczenia: każdy odgłos przypada na przebyty odcinek (nie na stały zegar),
 * więc bieg z Shift automatycznie przyspiesza kroki, a stanie i samo obracanie kamery ich nie wywołuje.
 * Warianty i drobne zmiany tonu losujemy, żeby uniknąć mechanicznej pętli.
 */
export class FootstepScheduler {
  private travelled = 0;
  private moving = false;
  private lastVariant = -1;
  private _running = false;

  constructor(
    private readonly rng: () => number,
    private readonly variants: () => number,
    readonly config: FootstepConfig = DEFAULT_FOOTSTEP_CONFIG,
  ) {}

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
  }

  update(sample: MotionSample): FootstepEvent[] {
    const c = this.config;
    const speed = sample.dt > 0 ? sample.distance / sample.dt : 0;
    if (sample.frozen || speed < c.minSpeed || sample.distance > c.teleportDistance) {
      this.reset();
      return [];
    }
    if (!this.moving) {
      this.moving = true;
      this.travelled = c.startFraction * c.walkStride;
    }
    this._running = speed >= c.runSpeed;
    const stride = this._running ? c.runStride : c.walkStride;
    this.travelled += sample.distance;
    const events: FootstepEvent[] = [];
    while (this.travelled >= stride && events.length < 3) {
      this.travelled -= stride;
      events.push(this.makeEvent());
    }
    if (this.travelled >= stride) this.travelled = 0;
    return events;
  }

  private makeEvent(): FootstepEvent {
    const c = this.config;
    const count = Math.max(1, this.variants());
    let variant = Math.min(count - 1, Math.floor(this.rng() * count));
    if (count > 1 && variant === this.lastVariant) variant = (variant + 1 + Math.floor(this.rng() * (count - 1))) % count;
    this.lastVariant = variant;
    const gain = (c.gain[0] + (c.gain[1] - c.gain[0]) * this.rng()) * (this._running ? c.runGain : 1);
    return {
      variant,
      gain,
      rate: 1 + (this.rng() * 2 - 1) * c.pitch + (this._running ? 0.05 : 0),
      run: this._running,
      lowpass: 3500 + this.rng() * 4500,
    };
  }
}
