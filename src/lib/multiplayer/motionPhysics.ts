import type { WalkWorld } from "../game/world/walk";
import { TPP_DEFAULTS } from "../tpp/config";
import type { Motion } from "./protocol";

/**
 * Walidacja pionowa ruchu po stronie serwera (M1a, fizyka skał v1). Serwer NIE symuluje postaci: klient jest autorytatywny
 * dla ruchu, a serwer odrzuca tylko stany niemożliwe do osiągnięcia fizyką gry (skok na wysoką skałę, "stanie" w powietrzu
 * na wysokości, której nie ma w świecie, wejście w bryłę skały od strony, z której nie da się jej minąć). Reguły używają
 * STAŁYCH wartości domyślnych TPP (`TPP_DEFAULTS`), a nie lokalnych ustawień gracza z panelu diagnostycznego, więc
 * suwaki skoku i grawitacji nie omijają zasad serwera. To sprawdzenie wykonalności z tolerancjami, a nie pełna symulacja:
 * dostatecznie sprytny klient może wysyłać stany wyglądające prawdopodobnie. Brak kanału korekcji: odrzucona wiadomość
 * jest po prostu ignorowana, a kolejne (z dłuższym czasem od ostatniej przyjętej) są oceniane względem ostatniej przyjętej.
 */
export const MOTION_RULES = Object.freeze({
  jumpHeight: TPP_DEFAULTS.jumpHeight,
  gravity: TPP_DEFAULTS.gravity,
  runSpeed: TPP_DEFAULTS.runSpeed,
  /** Tolerancja pionowa (m): dyskretna całka klienta, nachylenie terenu, przechył wierzchu skały. */
  heightTolerance: 0.25,
  /** Tolerancja pozycji stóp względem powierzchni, na której ciało jest "na ziemi" (m). */
  supportTolerance: 0.15,
  /** Zapas czasu (s) na nierówny rytm dostarczania wiadomości (jitter sieci), dodawany do czasu od ostatniej przyjętej. */
  jitterAllowance: 0.1,
  /** Najdłuższy czas (s) liczony od ostatniej przyjętej wiadomości. */
  maxElapsed: 5,
  /** Zapas odległości (m) ponad prędkość biegu, powyżej którego kolejna próbka to nieciągłość (np. odrodzenie), a nie ruch. */
  continuityPad: 0.6,
  /** Mnożnik prędkości biegu dla ciągłości ruchu poziomego. */
  continuitySpeedFactor: 1.6,
  /** Skok bez historii (nieciągłość): największa wysokość stania nad terenem (m). */
  staticSurfaceAboveTerrain: TPP_DEFAULTS.jumpHeight + 0.25,
  /** Skok bez historii: największa wysokość w powietrzu nad podłożem (m); luźny limit zdrowego rozsądku. */
  staticAirAboveFloor: 8,
  /** Rozstaw próbek (m) na cięciwie między dwiema wiadomościami przy wykrywaniu przejścia przez skałę. */
  chordStep: 0.2,
  /** Tolerancja promienia ciała (m) przy wykrywaniu przejścia przez skałę. */
  bodyTolerance: 0.08,
});

export type MotionReason = "below_ground" | "unsupported" | "too_high" | "rise_too_fast" | "inside_rock" | "teleport";

/** Stan ostatniej PRZYJĘTEJ wiadomości ruchu sesji. `anchorY` to wysokość stóp ostatnio na ziemi (podstawa limitu skoku). */
export type MotionTrack = { x: number; y: number; z: number; at: number; grounded: boolean; anchorY: number; rockId: string | null };

export type MotionWorld = {
  walk: WalkWorld;
  /** Wysokość pokładu mostu w (x, z) albo null; podawana tylko, gdy most jest zbudowany. */
  deckHeightAt?: ((x: number, z: number) => number | null) | null;
};

export type MotionVerdict = { ok: true; track: MotionTrack } | { ok: false; reason: MotionReason };

type Sample = Pick<Motion, "x" | "y" | "z" | "grounded">;

const jumpSpeed = () => Math.sqrt(2 * MOTION_RULES.gravity * MOTION_RULES.jumpHeight);

/** Początkowy stan sesji: spawn na ziemi, na terenie. */
export function initialTrack(x: number, y: number, z: number, now: number): MotionTrack {
  return { x, y, z, at: now, grounded: true, anchorY: y, rockId: null };
}

/**
 * Ocena kolejnej wiadomości ruchu względem ostatniej przyjętej. `now` w sekundach (zegar serwera). Reguły:
 * 1. (ruch ciągły) stopy nie są pod terenem ani pokładem mostu;
 * 2. na ziemi: stopy leżą na terenie, moście albo powierzchni stania skały (nie "w powietrzu" na szczycie wysokiej skały);
 * 3. ruch ciągły (odległość osiągalna biegiem): wzniesienie nie szybsze niż skok, w powietrzu nie wyżej niż wysokość stóp
 *    ostatnio na ziemi plus wysokość skoku, na ziemi na skale nie wyżej niż to samo, a cięciwa nie przechodzi przez bryłę
 *    skały, nad którą stopy nie były dość wysoko;
 * 4. nieciągłość (odrodzenie, pierwsza wiadomość): tylko reguły statyczne (2 oraz limity wysokości nad terenem); serwer nie
 *    weryfikuje tu położenia poziomego, tak jak dotąd (M1a).
 */
export function checkMotion(world: MotionWorld, prev: MotionTrack | null, next: Sample, now: number, options: { strict?: boolean } = {}): MotionVerdict {
  const R = MOTION_RULES;
  const { walk } = world;
  const terrainY = walk.terrain.height(next.x, next.z);
  const deck = world.deckHeightAt?.(next.x, next.z) ?? null;
  const floor = deck != null ? Math.max(terrainY, deck) : terrainY;

  const elapsed = prev ? Math.min(Math.max(now - prev.at, 0), R.maxElapsed) : 0;
  const reach = R.runSpeed * R.continuitySpeedFactor * (elapsed + R.jitterAllowance) + R.continuityPad;
  const continuous = prev !== null && Math.hypot(next.x - prev.x, next.z - prev.z) <= reach;
  // Tryb ścisły (uczestnicy zabawy w chowanego): nieciągłość to teleport, nie odrodzenie, więc nie jest przyjmowana.
  if (options.strict && prev && !continuous) return { ok: false, reason: "teleport" };

  // Podparcie przy deklaracji "na ziemi".
  let rockId: string | null = null;
  let surfaceY = floor;
  if (next.grounded) {
    const rock = walk.supportSurfaceAt(next.x, next.z, next.y, R.supportTolerance, R.supportTolerance);
    const onFloor = Math.abs(next.y - floor) <= R.supportTolerance;
    if (rock && (!onFloor || rock.y > floor)) {
      rockId = rock.id;
      surfaceY = rock.y;
    } else if (!onFloor) return { ok: false, reason: "unsupported" };
  }

  if (continuous && prev) {
    if (next.y < floor - R.heightTolerance) return { ok: false, reason: "below_ground" };
    const budget = jumpSpeed() * (elapsed + R.jitterAllowance) + R.heightTolerance;
    if (next.y - prev.y > budget) return { ok: false, reason: "rise_too_fast" };
    const ceiling = prev.anchorY + R.jumpHeight + R.heightTolerance;
    if (next.grounded ? surfaceY > ceiling : next.y > ceiling) return { ok: false, reason: "too_high" };
    // Cięciwa: bryła skały, nad którą stopy nie były dość wysoko, blokuje przejście (jak `WalkWorld.move` po stronie klienta).
    const footY = Math.max(prev.y, next.y);
    const body = { footY, supportId: prev.rockId };
    const dist = Math.hypot(next.x - prev.x, next.z - prev.z);
    const n = Math.max(1, Math.ceil(dist / R.chordStep));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const x = prev.x + (next.x - prev.x) * t;
      const z = prev.z + (next.z - prev.z) * t;
      if (walk.rockBlockingAt(x, z, prev, body, R.bodyTolerance)) return { ok: false, reason: "inside_rock" };
    }
  } else if (next.grounded) {
    if (surfaceY > terrainY + R.staticSurfaceAboveTerrain && (deck == null || surfaceY > deck + R.heightTolerance)) return { ok: false, reason: "too_high" };
  } else if (next.y > floor + R.staticAirAboveFloor) {
    return { ok: false, reason: "too_high" };
  }

  const anchorY = next.grounded ? next.y : continuous && prev ? prev.anchorY : floor;
  return { ok: true, track: { x: next.x, y: next.y, z: next.z, at: now, grounded: next.grounded, anchorY, rockId } };
}
