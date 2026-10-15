/** Statystyki klatek: bieżący i średni FPS, czas klatki, percentyle. Czyste, wywoływane z `requestAnimationFrame`. */
export class FrameStats {
  private readonly window: number[] = [];
  private readonly all: number[] = [];
  private total = 0;
  private frames = 0;

  constructor(
    private readonly windowSeconds = 0.5,
    private readonly keepAll = false,
  ) {}

  /** `dtMs` – czas klatki w ms (z zegara przeglądarki). Zwraca się, gdy dane są nieprawidłowe. */
  push(dtMs: number): void {
    if (!Number.isFinite(dtMs) || dtMs <= 0 || dtMs > 2000) return;
    this.window.push(dtMs);
    let sum = 0;
    for (const v of this.window) sum += v;
    while (this.window.length > 1 && sum > this.windowSeconds * 1000) sum -= this.window.shift()!;
    this.total += dtMs;
    this.frames++;
    if (this.keepAll) this.all.push(dtMs);
  }

  /** FPS z ostatniego okna (domyślnie 0,5 s). */
  get currentFps(): number {
    if (this.window.length === 0) return 0;
    let sum = 0;
    for (const v of this.window) sum += v;
    return (this.window.length / sum) * 1000;
  }

  /** Średni czas klatki z ostatniego okna (ms). */
  get frameMs(): number {
    if (this.window.length === 0) return 0;
    let sum = 0;
    for (const v of this.window) sum += v;
    return sum / this.window.length;
  }

  get averageFps(): number {
    return this.total > 0 ? (this.frames / this.total) * 1000 : 0;
  }

  get frameCount(): number {
    return this.frames;
  }

  reset(): void {
    this.window.length = 0;
    this.all.length = 0;
    this.total = 0;
    this.frames = 0;
  }

  /** Raport z wszystkich klatek od `reset` (wymaga `keepAll`). `onePercentLowFps` = FPS z 99. percentyla czasu klatki. */
  summary() {
    const sorted = [...this.all].sort((a, b) => a - b);
    const q = (p: number) => (sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]);
    const p99 = q(0.99);
    return {
      frames: this.frames,
      seconds: this.total / 1000,
      averageFps: this.averageFps,
      medianMs: q(0.5),
      p95Ms: q(0.95),
      p99Ms: p99,
      maxMs: sorted.length ? sorted[sorted.length - 1] : 0,
      onePercentLowFps: p99 > 0 ? 1000 / p99 : 0,
    };
  }
}
