import type { ActiveDevice, HintAction } from "./actions";
import { BUTTON_GLYPHS, KEYBOARD_LABELS, buttonForHint } from "./gamepadConfig";

/** Etykiety osi i krzyżaka (nie są pojedynczymi przyciskami mapowania). */
const PAD_STATIC: Partial<Record<HintAction, string>> = {
  move: "lewy analog",
  look: "prawy analog",
  navigate: "D-pad",
};

/**
 * Jedno źródło etykiet podpowiedzi: zależą od aktywnego urządzenia i mapowania (`BUTTON_BINDINGS`), a nie od napisów
 * wpisanych w komponentach. Zwraca null, gdy akcja nie ma odpowiednika na danym urządzeniu.
 */
export function hintLabel(action: HintAction, device: ActiveDevice): string | null {
  if (device === "keyboard") return KEYBOARD_LABELS[action];
  const fixed = PAD_STATIC[action];
  if (fixed) return fixed;
  const button = buttonForHint(action);
  if (button === null) return null;
  return BUTTON_GLYPHS[device][button] ?? null;
}

export type HintRow = { action: HintAction; label: string };

/** Opisy sterowania w lesie dla pomocy ekranowej (klawiatura albo pad). */
const FOREST_HELP: readonly { actions: HintAction[]; text: string }[] = [
  { actions: ["move"], text: "ruch" },
  { actions: ["look"], text: "rozglądanie" },
  { actions: ["sprint"], text: "bieg (trzymaj z ruchem)" },
  { actions: ["jump"], text: "skok" },
  { actions: ["crouch"], text: "kucanie" },
  { actions: ["interact"], text: "interakcja" },
  { actions: ["inventory"], text: "ekwipunek" },
  { actions: ["journal"], text: "dziennik" },
  { actions: ["minimap"], text: "minimapa" },
  { actions: ["slotPrev", "slotNext"], text: "slot paska" },
  { actions: ["pause"], text: "menu" },
];

export type ForestHelpEntry = { keys: string[]; label: string };

/** Pomoc dla pada; wariant klawiatury pozostaje w `FOREST_CONTROLS` (`shortcuts.ts`). */
export function padForestHelp(device: Exclude<ActiveDevice, "keyboard">): ForestHelpEntry[] {
  const out: ForestHelpEntry[] = [];
  for (const row of FOREST_HELP) {
    const keys = row.actions.map((a) => hintLabel(a, device)).filter((k): k is string => !!k);
    if (keys.length > 0) out.push({ keys, label: row.text });
  }
  return out;
}
