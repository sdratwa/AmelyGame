import type { NavDirection } from "./actions";
import { MODAL_CONFIRM_GRACE_MS } from "./gamepadConfig";

/** Logika nawigacji po interfejsie niezależna od DOM (na prostokątach), testowalna w Node. */

export type NavRect = { left: number; top: number; right: number; bottom: number };

function center(r: NavRect): { x: number; y: number } {
  return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
}

/**
 * Najbliższy element w zadanym kierunku. Wynik ważony: odległość wzdłuż kierunku + podwojona odległość boczna (preferuje
 * elementy "na wprost"). Zwraca indeks albo -1, gdy w tym kierunku nic nie ma.
 */
export function pickNeighbor(rects: readonly NavRect[], current: number, dir: NavDirection): number {
  const cur = rects[current];
  if (!cur) return -1;
  const o = center(cur);
  let best = -1;
  let bestScore = Infinity;
  for (let i = 0; i < rects.length; i++) {
    if (i === current) continue;
    const c = center(rects[i]);
    const dx = c.x - o.x;
    const dy = c.y - o.y;
    let along: number;
    let across: number;
    switch (dir) {
      case "up":
        along = -dy;
        across = dx;
        break;
      case "down":
        along = dy;
        across = dx;
        break;
      case "left":
        along = -dx;
        across = dy;
        break;
      default:
        along = dx;
        across = dy;
    }
    if (along <= 1) continue;
    // Element, którego rzut na oś poprzeczną nakłada się na bieżący, jest "na wprost": bez kary bocznej.
    const overlap = dir === "up" || dir === "down" ? overlapLen(cur.left, cur.right, rects[i].left, rects[i].right) : overlapLen(cur.top, cur.bottom, rects[i].top, rects[i].bottom);
    const score = along + (overlap > 0 ? 0.25 : 2) * Math.abs(across);
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

function overlapLen(a0: number, a1: number, b0: number, b1: number): number {
  return Math.min(a1, b1) - Math.max(a0, b0);
}

/** Pierwszy element do podświetlenia, gdy nic nie ma fokusu: lewy górny (kolejność: góra, potem lewa strona). */
export function pickInitial(rects: readonly NavRect[]): number {
  let best = -1;
  let bestScore = Infinity;
  for (let i = 0; i < rects.length; i++) {
    const c = center(rects[i]);
    const score = c.y * 4 + c.x;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/**
 * Ochrona przed zatwierdzeniem tym samym naciśnięciem, które otworzyło okno (albo przełączyło jego zawartość):
 * zatwierdzanie jest ignorowane przez krótką chwilę po zmianie zestawu okien.
 */
export class ModalGrace {
  private changedAt = -Infinity;

  constructor(private readonly graceMs: number = MODAL_CONFIRM_GRACE_MS) {}

  noteChange(t: number): void {
    this.changedAt = t;
  }

  allowsConfirm(t: number): boolean {
    return t - this.changedAt >= this.graceMs;
  }
}
