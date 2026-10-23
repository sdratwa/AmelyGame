import type { HsMini, HsPhase, HsRole } from "./types";

/**
 * Reguły widoczności, kolizji i oznaczeń w trakcie zabawy. To jedyne źródło prawdy: korzystają z niego serwer
 * (filtrowanie snapshotów, kolizje w `motion`) i klient (etykiety, minimapa), więc żaden moduł nie może „przywrócić”
 * nazwy ukrytego gracza. Logika jest ogólna - po zmianie nazw ról obsłuży też kolejne minigry z grupą uczestników.
 */

/** Aktywna faza, w której uczestnicy są odizolowani od reszty świata. */
export const isActivePhase = (phase: HsPhase): boolean => phase === "HIDING" || phase === "SEEKING";

const isHider = (role: HsRole | null) => role === "HIDER_MOVING" || role === "HIDER_LOCKED";

/** Rola uczestnika, o ile nadal jest on w izolowanej grupie (WITHDRAWN i brak roli = „poza zabawą”). */
const member = (role: HsRole | null): HsRole | null => (role === "WITHDRAWN" ? null : role);

export type Relation = { visible: boolean; collides: boolean };

/**
 * Czy `viewer` widzi `target` i czy ciała się zderzają.
 * - poza aktywną fazą wszyscy widzą się normalnie;
 * - uczestnicy i osoby spoza zabawy nie widzą się wzajemnie i nie kolidują (ta sama geometria świata, bez drugiej instancji);
 * - szukający nie widzi ukrywających się przed fazą SEEKING;
 * - znalezieni gracze nie zderzają się z nikim z grupy (nie przeszkadzają szukającemu).
 */
export function relationBetween(phase: HsPhase, viewerRole: HsRole | null, targetRole: HsRole | null): Relation {
  if (!isActivePhase(phase)) return { visible: true, collides: true };
  const v = member(viewerRole);
  const t = member(targetRole);
  if (v === null && t === null) return { visible: true, collides: true };
  if ((v === null) !== (t === null)) return { visible: false, collides: false };
  const visible = !(v === "SEEKER" && isHider(t) && phase !== "SEEKING");
  const collides = visible && v !== "HIDER_FOUND" && t !== "HIDER_FOUND";
  return { visible, collides };
}

/** Czy kapsuły dwóch graczy mogą się wzajemnie blokować (kolizja liczona symetrycznie: oba kierunki muszą ją dopuszczać). */
export function bodiesCollide(phase: HsPhase, a: HsRole | null, b: HsRole | null): boolean {
  return relationBetween(phase, a, b).collides && relationBetween(phase, b, a).collides;
}

/**
 * Nadrzędny warunek widoczności nazwy nad postacią: nazwy ukrywających się są niewidoczne bez względu na ustawienia
 * interfejsu. Wszystkie moduły rysujące etykiety (3D i minimapa) muszą pytać tej funkcji.
 */
export function playerLabelVisible(showNames: boolean, mini: HsMini | null | undefined): boolean {
  if (mini === "hider") return false;
  return showNames;
}

/** Czy zdalny gracz dostaje znacznik na minimapie: ukryci nigdy, szukający tylko poza zabawą (nie zdradza go ukrywającym). */
export function minimapMarkerVisible(mini: HsMini | null | undefined): boolean {
  return mini === undefined || mini === null || mini === "found";
}

/** Rola z oznaczenia `Player.mini` (po stronie klienta nie znamy dokładniejszej roli; do kolizji wystarcza). */
export function roleOfMini(mini: HsMini | null | undefined): HsRole | null {
  if (mini === "seeker") return "SEEKER";
  if (mini === "hider") return "HIDER_LOCKED";
  if (mini === "found") return "HIDER_FOUND";
  return null;
}
