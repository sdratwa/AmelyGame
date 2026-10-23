/**
 * Skróty klawiszowe niezależne od frameworka i DOM (testowalne w Node).
 * Dopasowanie literowe używa wydrukowanego znaku (`key`), a dla układów bez liter łacińskich
 * (np. cyrylica) pozycji klawisza (`code`); dzięki temu działa na macOS, Windows i Linuksie.
 */

export type KeyLike = {
  key: string;
  code?: string;
  repeat?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
  target?: unknown;
};

type ElementLike = {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
  readOnly?: boolean;
  getAttribute?: (name: string) => string | null;
  closest?: (selector: string) => unknown;
};

const NON_TEXT_INPUT_TYPES = new Set(["button", "checkbox", "radio", "range", "submit", "reset", "image", "file", "color"]);
const TEXT_ROLES = new Set(["textbox", "searchbox", "combobox", "spinbutton"]);

/** Czy zdarzenie pochodzi z elementu, w którym użytkownik pisze (wtedy skróty nie mogą go przechwytywać). */
export function isTextEntryTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as ElementLike;
  const tag = el.tagName?.toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !NON_TEXT_INPUT_TYPES.has((el.type ?? "text").toLowerCase());
  if (el.isContentEditable) return true;
  const role = el.getAttribute?.("role");
  if (role && TEXT_ROLES.has(role)) return true;
  const editable = el.closest?.('[contenteditable=""],[contenteditable="true"]');
  return Boolean(editable);
}

/** Czy naciśnięto literę `letter` (a-z) bez modyfikatorów systemowych; Shift jest dozwolony (bieg). */
export function isLetterKey(e: KeyLike, letter: string): boolean {
  const l = letter.toLowerCase();
  const k = e.key;
  if (k.length === 1 && /[a-z]/i.test(k)) return k.toLowerCase() === l;
  return e.code === `Key${l.toUpperCase()}`;
}

function plain(e: KeyLike): boolean {
  return !e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing;
}

/**
 * Skrót pojedynczej litery (E, I, J, M, O): bez powtórzeń, bez Ctrl/Cmd/Alt i poza polami tekstowymi.
 */
export function isGameLetterShortcut(e: KeyLike, letter: string): boolean {
  return !e.repeat && plain(e) && isLetterKey(e, letter) && !isTextEntryTarget(e.target);
}

/** Panel diagnostyczny: O (macOS i reszta) albo F3 (Windows i inne klawiatury). */
export function isDiagnosticsShortcut(e: KeyLike): boolean {
  if (e.repeat) return false;
  if (e.key === "F3" || e.code === "F3") return !e.ctrlKey && !e.metaKey && !e.altKey;
  return isGameLetterShortcut(e, "o");
}

export type ControlEntry = { keys: string[]; label: string };

/** Jedno źródło prawdy dla ekranu pomocy w lesie i dokumentacji sterowania. */
export const FOREST_CONTROLS: readonly ControlEntry[] = [
  { keys: ["W", "A", "S", "D"], label: "ruch" },
  { keys: ["Shift"], label: "bieg" },
  { keys: ["Spacja"], label: "skok" },
  { keys: ["C"], label: "kucanie" },
  { keys: ["E"], label: "interakcja" },
  { keys: ["I"], label: "ekwipunek" },
  { keys: ["J"], label: "dziennik" },
  { keys: ["M"], label: "minimapa" },
  { keys: ["L"], label: "lampa naftowa" },
  { keys: ["O", "F3"], label: "panel diagnostyczny" },
  { keys: ["Esc"], label: "zamknięcie okna, zwolnienie myszy" },
];

/** Zabawa w chowanego: jeden klawisz kontekstowy (TO MOJA KRYJÓWKA! w chowaniu, ZNALAZŁEM! w szukaniu). Podpowiedź jest tylko na przycisku w grze. */
export const HIDESEEK_KEY = "h";
