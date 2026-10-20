/**
 * Worek losowania: każda wartość 0..count-1 pada raz na rundę w losowej kolejności, potem kolejność jest tasowana od nowa.
 * Ta sama wartość nigdy nie pada dwa razy z rzędu, także na granicy rund. Każdy worek ma własny stan i własny generator.
 */
export class ShuffleBag {
  private order: number[] = [];
  private index = 0;
  private lastValue = -1;
  private rounds = 0;

  constructor(
    readonly count: number,
    private readonly rng: () => number,
  ) {
    if (!Number.isInteger(count) || count < 1) throw new Error("ShuffleBag: count musi być dodatnią liczbą całkowitą");
    this.order = Array.from({ length: count }, (_, i) => i);
    this.index = count;
  }

  /** Numer ostatnio wylosowanej wartości (-1 przed pierwszym losowaniem). */
  get last(): number {
    return this.lastValue;
  }

  /** Ile razy tasowano (pierwsze losowanie to runda 1). */
  get roundsStarted(): number {
    return this.rounds;
  }

  next(): number {
    if (this.index >= this.order.length) this.reshuffle();
    const value = this.order[this.index++];
    this.lastValue = value;
    return value;
  }

  private reshuffle(): void {
    const a = this.order;
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.min(i, Math.floor(this.rng() * (i + 1)));
      [a[i], a[j]] = [a[j], a[i]];
    }
    if (a.length > 1 && a[0] === this.lastValue) {
      const k = 1 + Math.min(a.length - 2, Math.floor(this.rng() * (a.length - 1)));
      [a[0], a[k]] = [a[k], a[0]];
    }
    this.index = 0;
    this.rounds++;
  }
}

/** Niezależny generator pochodny: dwa losowania z bazowego ustalają ziarno (xmur/mulberry), potem strumień nie zależy od bazowego. */
export function forkRng(base: () => number): () => number {
  let a = (Math.floor(base() * 0xffffffff) ^ Math.floor(base() * 0xffffffff)) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
