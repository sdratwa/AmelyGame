import { LAMP_OFF_SECONDS, LAMP_ON_SECONDS } from "./config";
import type { Rng } from "./areas";

const between = (rng: Rng, [lo, hi]: readonly [number, number]) => (lo + rng() * (hi - lo)) * 1000;

/**
 * Harmonogram wymuszonych rozbłysków lampy jednego ukrywającego się: świeci 2-3 s, gaśnie na 5-10 s, i tak w kółko.
 * Każdy gracz ma własną instancję i własny losowy początek (pierwsza przerwa to losowa część pełnej przerwy), więc
 * fazy nie są zsynchronizowane. Czas jest podawany z zewnątrz (ms), dzięki czemu testy nie czekają naprawdę.
 */
export class LampSchedule {
  on = false;
  private nextAt: number;

  constructor(
    private readonly rng: Rng,
    start: number,
  ) {
    this.nextAt = start + this.rng() * between(this.rng, LAMP_OFF_SECONDS);
  }

  /** Przesuwa harmonogram do chwili `now`; zwraca, czy lampa ma teraz świecić. */
  advance(now: number): boolean {
    while (this.nextAt <= now) {
      this.on = !this.on;
      this.nextAt += between(this.rng, this.on ? LAMP_ON_SECONDS : LAMP_OFF_SECONDS);
    }
    return this.on;
  }
}
