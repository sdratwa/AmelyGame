"use client";

import { useInputDevice } from "./hooks";

const LETTER_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm", "ąćęłńóśźż"];
const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

type Props = {
  mode: "digits" | "text";
  /** Aktualna wartość pola (do automatycznej wielkiej litery na początku i po spacji). */
  value: string;
  maxLength?: number;
  onChange: (next: string) => void;
  /** Pokazywane tylko, gdy aktywnym urządzeniem jest pad (domyślnie), albo zawsze, gdy `always`. */
  always?: boolean;
};

const KEY = "h-9 min-w-9 rounded-md bg-white/10 px-2 text-sm font-semibold text-white transition hover:bg-white/20 active:scale-95";

/**
 * Ekranowa klawiatura dla pada (D-pad wybiera, ✕/A wpisuje). Zwykłe przyciski, więc korzysta z natywnego fokusu i
 * nawigacji interfejsu; nie pojawia się, gdy gracz używa klawiatury.
 */
export function PadKeyboard({ mode, value, maxLength = 20, onChange, always = false }: Props) {
  const device = useInputDevice();
  if (!always && device === "keyboard") return null;
  const add = (ch: string) => {
    if (value.length < maxLength) onChange(value + ch);
  };
  const back = () => onChange(value.slice(0, -1));

  if (mode === "digits") {
    return (
      <div data-testid="pad-keyboard" role="group" aria-label="Klawiatura ekranowa (cyfry)" className="grid grid-cols-5 gap-1.5">
        {DIGITS.map((d) => (
          <button key={d} type="button" data-testid={`pad-key-${d}`} onClick={() => add(d)} className={KEY}>
            {d}
          </button>
        ))}
        <button type="button" data-testid="pad-key-0" onClick={() => add("0")} className={KEY}>
          0
        </button>
        <button type="button" data-testid="pad-key-minus" onClick={() => add("-")} className={KEY} aria-label="Minus">
          −
        </button>
        <button type="button" data-testid="pad-key-back" onClick={back} className={`${KEY} col-span-3`} aria-label="Usuń ostatni znak">
          ⌫ Usuń
        </button>
      </div>
    );
  }

  const upper = value === "" || value.endsWith(" ");
  return (
    <div data-testid="pad-keyboard" role="group" aria-label="Klawiatura ekranowa (litery)" className="grid gap-1.5">
      {LETTER_ROWS.map((row) => (
        <div key={row} className="flex flex-wrap justify-center gap-1">
          {[...row].map((ch) => {
            const shown = upper ? ch.toUpperCase() : ch;
            return (
              <button key={ch} type="button" data-testid={`pad-key-${ch}`} onClick={() => add(shown)} className={KEY}>
                {shown}
              </button>
            );
          })}
        </div>
      ))}
      <div className="flex justify-center gap-1">
        <button type="button" data-testid="pad-key-space" onClick={() => add(" ")} className={`${KEY} w-32`}>
          spacja
        </button>
        <button type="button" data-testid="pad-key-back" onClick={back} className={KEY} aria-label="Usuń ostatni znak">
          ⌫
        </button>
      </div>
    </div>
  );
}
