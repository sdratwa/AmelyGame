import type { ActiveDevice, HintAction, InputAction } from "./actions";

/**
 * Centralna konfiguracja mapowania kontrolera (standardowe mapowanie Gamepad API). Żaden inny moduł nie powinien
 * zawierać numerów przycisków ani osi. Przyszły remapping zmieni tylko tę tabelę.
 */

/** Indeksy przycisków standardowego mapowania (https://www.w3.org/TR/gamepad/#remapping). */
export const BTN = {
  cross: 0, // PS: ✕, Xbox: A
  circle: 1, // PS: ○, Xbox: B
  square: 2, // PS: □, Xbox: X
  triangle: 3, // PS: △, Xbox: Y
  l1: 4,
  r1: 5,
  l2: 6,
  r2: 7,
  share: 8,
  options: 9,
  l3: 10,
  r3: 11,
  up: 12,
  down: 13,
  left: 14,
  right: 15,
  home: 16,
} as const;

/** Indeksy osi standardowego mapowania. Oś Y: -1 = w górę. */
export const AXIS = { leftX: 0, leftY: 1, rightX: 2, rightY: 3 } as const;

/** Liczba miejsc na przyciski w tablicach stanu (standard: 17). */
export const BUTTON_SLOTS = 17;
/** Minimalna liczba przycisków i osi, aby uznać kontroler za zgodny ze standardem. */
export const MIN_STANDARD_BUTTONS = 16;
export const MIN_STANDARD_AXES = 4;

/** Przycisk analogowy (spusty) jest wciśnięty od `ON`, zwolniony poniżej `OFF` (histereza). */
export const BUTTON_ON = 0.5;
export const BUTTON_OFF = 0.35;

/** Nawigacja po interfejsie lewym analogiem: próg włączenia i wyłączenia kierunku. */
export const NAV_STICK_ON = 0.6;
export const NAV_STICK_OFF = 0.4;
/** Autopowtarzanie nawigacji (D-pad i lewy analog): pierwsze opóźnienie i odstęp. */
export const NAV_DELAY_MS = 350;
export const NAV_REPEAT_MS = 120;

/** Brak danych z pada krócej niż tyle ms nie jest traktowany jako rozłączenie. */
export const PAD_GRACE_MS = 500;

/** Wychylenie uznawane za "ruch" przy przełączaniu podpowiedzi (powyżej dryfu) i liczba klatek jego utrzymania. */
export const DEVICE_STICK_THRESHOLD = 0.5;
export const DEVICE_STICK_FRAMES = 4;

/** Odstęp między kolejnymi interakcjami z różnych źródeł (klawiatura + pad), ms. */
export const INTERACT_GATE_MS = 150;

/** Ignorowanie zatwierdzania w oknie tuż po jego pojawieniu się, ms. */
export const MODAL_CONFIRM_GRACE_MS = 250;

export type ButtonBinding = {
  button: number;
  /** Akcja w grze (wolny las bez okien). */
  game?: InputAction;
  /** Akcja w interfejsie (okno, miasto, sklep, menu). */
  ui?: InputAction;
  /** Akcja interfejsu z autopowtarzaniem (nawigacja); obsługuje ją repeater, nie zwykła krawędź. */
  repeat?: boolean;
};

export const BUTTON_BINDINGS: readonly ButtonBinding[] = [
  // ✕/A w lesie to skok (czytany bezpośrednio, patrz `TPP_BUTTONS`), w interfejsie zatwierdzanie.
  { button: BTN.cross, ui: "confirm" },
  { button: BTN.circle, ui: "cancel" },
  { button: BTN.triangle, game: "inventory", ui: "inventory" },
  // □/X: interakcja w lesie, dziennik w interfejsie (zamykanie dziennika). W lesie dziennik jest na L2/LT.
  { button: BTN.square, game: "interact", ui: "journal" },
  { button: BTN.l1, game: "minimap" },
  { button: BTN.l2, game: "journal" },
  { button: BTN.r1, game: "slotPrev" },
  { button: BTN.r2, game: "slotNext" },
  { button: BTN.options, game: "pause", ui: "pause" },
  { button: BTN.up, ui: "navUp", repeat: true },
  { button: BTN.down, ui: "navDown", repeat: true },
  { button: BTN.left, game: "slotPrev", ui: "navLeft", repeat: true },
  { button: BTN.right, game: "slotNext", ui: "navRight", repeat: true },
];

/** Przycisk trzymany: bieg (L3). */
export const SPRINT_BUTTON = BTN.l3;

/**
 * Sterowanie trzecioosobowe (gra i `/dev/third-person`): skok i przełączanie kucania. Ruch, kamera i bieg idą wspólnymi
 * osiami huba (lewy drążek, prawy drążek, L3). Przyciski są odczytywane bezpośrednio, bez akcji gry. Skok na ✕/A
 * wymusił przeniesienie interakcji na □/X (patrz `BUTTON_BINDINGS`), a dziennika na L2/LT.
 */
export const TPP_BUTTONS = { jump: BTN.cross, crouch: BTN.circle } as const;

export type PadFamily = "playstation" | "xbox" | "generic";

/** Rodzina kontrolera służy wyłącznie do doboru podpowiedzi (nigdy do logiki sterowania). */
export function padFamilyFromId(id: string): PadFamily {
  const s = id.toLowerCase();
  if (/054c|dualsense|dualshock|playstation|wireless controller|sony/.test(s)) return "playstation";
  if (/xbox|045e|xinput|microsoft/.test(s)) return "xbox";
  return "generic";
}

export function deviceOfFamily(family: PadFamily): ActiveDevice {
  return family === "playstation" ? "playstation" : "xbox";
}

const PS_GLYPHS: Record<number, string> = {
  [BTN.cross]: "✕",
  [BTN.circle]: "○",
  [BTN.square]: "□",
  [BTN.triangle]: "△",
  [BTN.l1]: "L1",
  [BTN.r1]: "R1",
  [BTN.l2]: "L2",
  [BTN.r2]: "R2",
  [BTN.options]: "OPTIONS",
  [BTN.l3]: "L3",
  [BTN.up]: "↑",
  [BTN.down]: "↓",
  [BTN.left]: "←",
  [BTN.right]: "→",
};

const XBOX_GLYPHS: Record<number, string> = {
  [BTN.cross]: "A",
  [BTN.circle]: "B",
  [BTN.square]: "X",
  [BTN.triangle]: "Y",
  [BTN.l1]: "LB",
  [BTN.r1]: "RB",
  [BTN.l2]: "LT",
  [BTN.r2]: "RT",
  [BTN.options]: "MENU",
  [BTN.l3]: "LS",
  [BTN.up]: "↑",
  [BTN.down]: "↓",
  [BTN.left]: "←",
  [BTN.right]: "→",
};

export const BUTTON_GLYPHS: Record<"playstation" | "xbox", Record<number, string>> = {
  playstation: PS_GLYPHS,
  xbox: XBOX_GLYPHS,
};

/** Etykiety klawiatury dla podpowiedzi (null = brak odpowiednika klawiszowego). */
export const KEYBOARD_LABELS: Record<HintAction, string | null> = {
  interact: "E",
  confirm: "Enter",
  cancel: "Esc",
  inventory: "I",
  journal: "J",
  minimap: "M",
  pause: null,
  slotPrev: "1-8",
  slotNext: "1-8",
  move: "WASD",
  look: "Mysz",
  sprint: "Shift",
  navigate: "Tab",
  jump: "Spacja",
  crouch: "C",
};

/** Przycisk pada odpowiadający akcji podpowiedzi (wynika z `BUTTON_BINDINGS`, nie z ręcznych napisów). */
export function buttonForHint(action: HintAction): number | null {
  switch (action) {
    case "interact":
      return bindingButton("interact", "game");
    case "confirm":
      return bindingButton("confirm", "ui");
    case "cancel":
      return bindingButton("cancel", "ui");
    case "inventory":
      return bindingButton("inventory", "game");
    case "journal":
      return bindingButton("journal", "game");
    case "minimap":
      return bindingButton("minimap", "game");
    case "pause":
      return bindingButton("pause", "game");
    case "slotPrev":
      return bindingButton("slotPrev", "game", BTN.r1);
    case "slotNext":
      return bindingButton("slotNext", "game", BTN.r2);
    case "sprint":
      return SPRINT_BUTTON;
    case "jump":
      return TPP_BUTTONS.jump;
    case "crouch":
      return TPP_BUTTONS.crouch;
    default:
      return null;
  }
}

function bindingButton(action: InputAction, mode: "game" | "ui", prefer?: number): number | null {
  const matches = BUTTON_BINDINGS.filter((b) => b[mode] === action);
  if (matches.length === 0) return null;
  if (prefer !== undefined && matches.some((b) => b.button === prefer)) return prefer;
  return matches[0].button;
}
