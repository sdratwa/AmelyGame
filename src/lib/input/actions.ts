/**
 * Warstwa abstrakcji wejścia: akcje gry są niezależne od źródła sygnału (klawiatura, mysz, pad; w przyszłości dotyk).
 * Osie ciągłe (MOVE, LOOK) i przycisk trzymany (SPRINT) są udostępniane przez `InputHub`; akcje jednorazowe przychodzą
 * jako zdarzenia `ActionEvent`.
 */

export type InputSource = "keyboard" | "mouse" | "gamepad" | "touch";

/** Źródła, które nie wywołują własnych zdarzeń DOM i przechodzą wyłącznie przez `InputHub.emit` (pad, dotyk). */
export function isHubSource(source: InputSource): boolean {
  return source === "gamepad" || source === "touch";
}

/** Akcje jednorazowe (jedno naciśnięcie = jedno zdarzenie). */
export type InputAction =
  | "interact"
  | "confirm"
  | "cancel"
  | "inventory"
  | "journal"
  | "minimap"
  | "lantern"
  | "hideSeek"
  | "pause"
  | "navUp"
  | "navDown"
  | "navLeft"
  | "navRight"
  | "slotPrev"
  | "slotNext";

export type NavDirection = "up" | "down" | "left" | "right";

export const NAV_ACTION: Record<NavDirection, InputAction> = {
  up: "navUp",
  down: "navDown",
  left: "navLeft",
  right: "navRight",
};

export function navDirectionOf(action: InputAction): NavDirection | null {
  switch (action) {
    case "navUp":
      return "up";
    case "navDown":
      return "down";
    case "navLeft":
      return "left";
    case "navRight":
      return "right";
    default:
      return null;
  }
}

export type ActionEvent = {
  action: InputAction;
  source: InputSource;
  /** Czas w ms (skala `performance.now()`). */
  time: number;
};

/** Zwrócenie `true` oznacza, że akcja została obsłużona i nie trafia do handlerów o niższym priorytecie. */
export type ActionHandler = (event: ActionEvent) => boolean | void;

/** Akcje, dla których interfejs pokazuje podpowiedź przycisku (klawiatura / PlayStation / Xbox). */
export type HintAction =
  | "interact"
  | "confirm"
  | "cancel"
  | "inventory"
  | "journal"
  | "minimap"
  | "lantern"
  | "hideSeek"
  | "pause"
  | "slotPrev"
  | "slotNext"
  | "move"
  | "look"
  | "sprint"
  | "jump"
  | "crouch"
  | "navigate";

/** Urządzenie, według którego dobieramy podpowiedzi. */
export type ActiveDevice = "keyboard" | "playstation" | "xbox";
