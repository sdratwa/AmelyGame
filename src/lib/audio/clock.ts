import { DAY_START_HOUR, HOURS_PER_DAY, SECONDS_PER_DAY, SECONDS_PER_GAME_HOUR } from "@/lib/game/core/constants";

/** Czas gry (s od początku) pierwszej północy: doba gry zaczyna się o 06:00, więc północ wypada po 18 godzinach. */
export const FIRST_MIDNIGHT = (HOURS_PER_DAY - DAY_START_HOUR) * SECONDS_PER_GAME_HOUR;

/** Pojedyncza zmiana czasu gry większa niż to (s) jest skokiem, a nie naturalnym upływem czasu (6 godzin gry). */
export const NATURAL_STEP_LIMIT = 6 * SECONDS_PER_GAME_HOUR;

/** Ułamkowa godzina zegara gry (0-24). */
export function gameHour(elapsed: number): number {
  const h = (DAY_START_HOUR + elapsed / SECONDS_PER_GAME_HOUR) % HOURS_PER_DAY;
  return h < 0 ? h + HOURS_PER_DAY : h;
}

/**
 * Numer północy: -1 przed pierwszą północą, 0 od pierwszej północy do drugiej itd.
 * Północ o numerze k przypada w dobie gry k (doba k trwa od 06:00 do następnego 06:00).
 */
export function midnightIndex(elapsed: number): number {
  return Math.floor((elapsed - FIRST_MIDNIGHT) / SECONDS_PER_DAY);
}

export type ClockStep =
  | { kind: "none" }
  | { kind: "crossed"; midnight: number }
  | { kind: "jump" }
  | { kind: "ignored" };

/**
 * Wykrywa przekroczenie północy przez zegar gry. Nie ocenia warunku `hour === 0`, tylko porównuje numer północy
 * przed i po zmianie czasu, więc zdarzenie nie może się powtórzyć w tej samej minucie ani podczas pauzy.
 * Skok (ręczna zmiana godziny, duża zmiana czasu) przesuwa tylko punkt odniesienia i nigdy nie wywołuje zdarzenia.
 */
export class MidnightWatcher {
  private last: number;
  private pendingJump: { target: number; until: number } | null = null;

  constructor(elapsed: number) {
    this.last = elapsed;
  }

  get elapsed(): number {
    return this.last;
  }

  /** Zapowiedź ręcznej zmiany czasu na `target`; pośrednie, starsze odczyty czasu są ignorowane do jej zastosowania. */
  expectJump(target: number, now: number, timeoutMs = 3000): void {
    this.pendingJump = { target, until: now + timeoutMs };
  }

  rebase(elapsed: number): void {
    this.last = elapsed;
    this.pendingJump = null;
  }

  advance(elapsed: number, now: number): ClockStep {
    if (!Number.isFinite(elapsed)) return { kind: "ignored" };
    const pending = this.pendingJump;
    if (pending) {
      if (now > pending.until) {
        this.pendingJump = null;
      } else if (elapsed + 1e-6 >= pending.target) {
        this.last = elapsed;
        this.pendingJump = null;
        return { kind: "jump" };
      } else {
        return { kind: "ignored" };
      }
    }
    const delta = elapsed - this.last;
    if (delta === 0) return { kind: "none" };
    const before = this.last;
    this.last = elapsed;
    if (delta < 0 || delta > NATURAL_STEP_LIMIT) return { kind: "jump" };
    const crossed = midnightIndex(elapsed);
    return crossed > midnightIndex(before) ? { kind: "crossed", midnight: crossed } : { kind: "none" };
  }
}
