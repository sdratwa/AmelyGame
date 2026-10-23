/**
 * Zabawa w chowanego (H1): typy wspólne dla serwera, klienta i testów. Moduł nie importuje Reacta, Three.js ani Colyseus.
 * Źródłem prawdy jest serwer; klient dostaje tylko widok (`HsStateView`) dopasowany do swojej roli.
 */

export type HsPhase = "INACTIVE" | "INVITING" | "HIDING" | "SEEKING" | "FINISHED" | "CANCELLED";

/** Rola uczestnika w sesji. `WITHDRAWN` = zrezygnował lub został wycofany (nie wygrywa i nie przegrywa). */
export type HsRole = "SEEKER" | "HIDER_MOVING" | "HIDER_LOCKED" | "HIDER_FOUND" | "WITHDRAWN";

export type HsInvite = "host" | "pending" | "accepted" | "declined";

/** Jawny, serwerowy wynik gracza. */
export type HsOutcome = "WIN" | "LOSE" | "WITHDRAWN" | "CANCELLED";

export type HsFinishReason = "ALL_FOUND" | "TIME_UP" | "TOO_MANY_MISSES";
export type HsCancelReason = "HOST_CANCELLED" | "NOBODY_JOINED" | "SEEKER_WITHDREW" | "SEEKER_LEFT" | "NO_PLAYERS";
export type HsEndReason = HsFinishReason | HsCancelReason;

/** Rola widoczna na zewnątrz (`Player.mini`): wystarcza do etykiet i znaczników, nie ujawnia kryjówek. */
export type HsMini = "seeker" | "hider" | "found";

/**
 * Bramka ruchu dla gracza lokalnego. Serwer wylicza ją dla każdego gracza i sam jej pilnuje w handlerze `motion`;
 * klient stosuje ten sam opis w `ThirdPersonRig`, żeby postać nie rozjeżdżała się z serwerem.
 * `anchor` != null: pozycja pozioma (x, z) jest zamrożona; pionowy skok zależy od `allowJump`.
 */
export type MovementGate = {
  anchor: { x: number; z: number } | null;
  allowJump: boolean;
  allowCrouch: boolean;
  allowLook: boolean;
  /** Kamera skierowana (prawie) pionowo w dół; blokuje też reset i przełączanie widoku. */
  cameraDown: boolean;
};

export const FREE_GATE: MovementGate = Object.freeze({ anchor: null, allowJump: true, allowCrouch: true, allowLook: true, cameraDown: false });

export type HideSeekConfig = {
  /** Czas poszukiwań w minutach (1-15); jedyny parametr dostępny w zwykłej konfiguracji. */
  seekMinutes: number;
  joinSeconds: number;
  hideSeconds: number;
  maxFailed: number;
  areaRadius: number;
  findDistance: number;
  lampHintSeconds: number;
  /** Ile czeka zaproszenie, jeśli nikt go nie przyjął. */
  inviteTimeoutSeconds: number;
  /** Krótki okres na ponowne połączenie, zanim gracz zostanie wycofany. */
  graceSeconds: number;
  /** Minimalny odstęp między dwiema sprawdzanymi próbami „ZNALAZŁEM”. */
  findCooldownMs: number;
};

export type HsSpot = { x: number; y: number; z: number; supportId: string | null };

export type HsArea = { id: string; x: number; z: number; r: number };

export type HsResultEntry = { name: string; role: "seeker" | "hider"; outcome: HsOutcome; found: boolean };

export type HsResult = { reason: HsEndReason; outcomes: HsResultEntry[] };

/** Widok sesji wysyłany jednemu graczowi (wiadomość `hs.state`). Zawiera tylko to, co ten gracz może wiedzieć. */
export type HsStateView = {
  rev: number;
  sessionId: string;
  hostName: string;
  phase: HsPhase;
  you: {
    role: HsRole | null;
    invite: HsInvite;
    isHost: boolean;
    /** Kryjówka została zatwierdzona automatycznie po upływie czasu. */
    autoLocked: boolean;
    /** Uczestnik, który ma ograniczone interakcje (questy, skrzynie, wspólny świat). */
    restricted: boolean;
  };
  /** Milisekundy do końca bieżącego etapu (liczone w chwili wysyłania) albo null. */
  endsInMs: number | null;
  /** Co odmierza `endsInMs`. */
  timer: "invite" | "join" | "hide" | "seek" | null;
  lobby: { invited: number; accepted: number; declined: number; pending: number; roster: { name: string; status: HsInvite }[] | null } | null;
  seek: { total: number; found: number; failed: number; maxFailed: number; lastThirty: boolean } | null;
  /** Obszary poszukiwań (tylko szukający w fazie SEEKING); bez identyfikatorów graczy. */
  areas: HsArea[] | null;
  gate: MovementGate;
  config: { seekMinutes: number; hideSeconds: number; joinSeconds: number; maxFailed: number; areaRadius: number; findDistance: number };
  result: (HsResult & { you: HsOutcome }) | null;
};

/** Wartość `HsMini` widoczna dla innych graczy; null = zwykły gracz. */
export function miniOfRole(role: HsRole | null): HsMini | null {
  switch (role) {
    case "SEEKER":
      return "seeker";
    case "HIDER_MOVING":
    case "HIDER_LOCKED":
      return "hider";
    case "HIDER_FOUND":
      return "found";
    default:
      return null;
  }
}

/** Kody odmów i podpowiedzi wysyłane przez serwer (`hs.notice`); polskie teksty trzyma klient (`texts.ts`). */
export type HsNoticeCode =
  | "NOT_IN_FOREST"
  | "SESSION_RUNNING"
  | "NO_PLAYERS"
  | "HIDE_AIRBORNE"
  | "HIDE_ILLEGAL"
  | "HIDE_STALE"
  | "FIND_STALE"
  | "WORLD_BLOCKED"
  | "LEAVE_BLOCKED"
  | "OFFLINE";

/** Zdarzenia jednorazowe (`hs.event`) - komunikaty dla szukającego i znalezionego; stan trwały jest w `hs.state`. */
export type HsEvent =
  | { kind: "hit"; name: string; left: number }
  | { kind: "found"; by: string }
  | { kind: "miss"; failed: number; max: number };

/** Nazwy wiadomości klient -> serwer. */
export const HS_CLIENT_MESSAGES = ["hs.start", "hs.cancel", "hs.respond", "hs.presence", "hs.hide", "hs.found", "hs.withdraw"] as const;
