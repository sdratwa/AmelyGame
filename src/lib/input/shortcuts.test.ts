import { describe, expect, it } from "vitest";
import { FOREST_CONTROLS, isDiagnosticsShortcut, isGameLetterShortcut, isLetterKey, isTextEntryTarget } from "./shortcuts";

const input = (type = "text") => ({ tagName: "INPUT", type });

describe("isTextEntryTarget", () => {
  it("rozpoznaje pola tekstowe, textarea, select i contenteditable", () => {
    expect(isTextEntryTarget(input())).toBe(true);
    expect(isTextEntryTarget(input("search"))).toBe(true);
    expect(isTextEntryTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTextEntryTarget({ tagName: "SELECT" })).toBe(true);
    expect(isTextEntryTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isTextEntryTarget({ tagName: "DIV", getAttribute: (n: string) => (n === "role" ? "textbox" : null) })).toBe(true);
    expect(isTextEntryTarget({ tagName: "SPAN", closest: () => ({}) })).toBe(true);
  });

  it("nie blokuje przycisków, pól wyboru ani zwykłych elementów", () => {
    expect(isTextEntryTarget(input("checkbox"))).toBe(false);
    expect(isTextEntryTarget(input("button"))).toBe(false);
    expect(isTextEntryTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isTextEntryTarget({ tagName: "CANVAS" })).toBe(false);
    expect(isTextEntryTarget(null)).toBe(false);
    expect(isTextEntryTarget(undefined)).toBe(false);
  });
});

describe("isLetterKey", () => {
  it("dopasowuje wielkość liter i Shift", () => {
    expect(isLetterKey({ key: "o" }, "o")).toBe(true);
    expect(isLetterKey({ key: "O" }, "o")).toBe(true);
    expect(isLetterKey({ key: "p" }, "o")).toBe(false);
  });

  it("używa pozycji klawisza dla układów bez liter łacińskich", () => {
    expect(isLetterKey({ key: "щ", code: "KeyO" }, "o")).toBe(true);
    expect(isLetterKey({ key: "ш", code: "KeyI" }, "o")).toBe(false);
  });

  it("w układzie Dvoraka liczy się wydrukowana litera, nie pozycja", () => {
    expect(isLetterKey({ key: "r", code: "KeyO" }, "o")).toBe(false);
    expect(isLetterKey({ key: "o", code: "KeyS" }, "o")).toBe(true);
  });
});

describe("isDiagnosticsShortcut", () => {
  it("O i F3 otwierają panel (macOS i Windows)", () => {
    expect(isDiagnosticsShortcut({ key: "o", code: "KeyO" })).toBe(true);
    expect(isDiagnosticsShortcut({ key: "O", code: "KeyO", target: { tagName: "CANVAS" } })).toBe(true);
    expect(isDiagnosticsShortcut({ key: "F3", code: "F3" })).toBe(true);
  });

  it("Shift+O działa (można trzymać bieg)", () => {
    expect(isDiagnosticsShortcut({ key: "O", code: "KeyO" })).toBe(true);
  });

  it("nie reaguje na powtórzenia ani na kombinacje systemowe", () => {
    expect(isDiagnosticsShortcut({ key: "o", repeat: true })).toBe(false);
    expect(isDiagnosticsShortcut({ key: "o", metaKey: true })).toBe(false);
    expect(isDiagnosticsShortcut({ key: "o", ctrlKey: true })).toBe(false);
    expect(isDiagnosticsShortcut({ key: "ø", code: "KeyO", altKey: true })).toBe(false);
    expect(isDiagnosticsShortcut({ key: "F3", ctrlKey: true })).toBe(false);
    expect(isDiagnosticsShortcut({ key: "F3", repeat: true })).toBe(false);
  });

  it("nie przechwytuje O podczas pisania ani składania znaków (IME)", () => {
    expect(isDiagnosticsShortcut({ key: "o", target: input() })).toBe(false);
    expect(isDiagnosticsShortcut({ key: "o", target: { tagName: "TEXTAREA" } })).toBe(false);
    expect(isDiagnosticsShortcut({ key: "o", isComposing: true })).toBe(false);
  });
});

describe("isGameLetterShortcut", () => {
  it("działa dla E, I, J, M poza polami tekstowymi", () => {
    for (const l of ["e", "i", "j", "m"]) {
      expect(isGameLetterShortcut({ key: l, target: { tagName: "CANVAS" } }, l)).toBe(true);
      expect(isGameLetterShortcut({ key: l.toUpperCase() }, l)).toBe(true);
      expect(isGameLetterShortcut({ key: l, target: input() }, l)).toBe(false);
    }
  });
});

describe("FOREST_CONTROLS", () => {
  const flat = FOREST_CONTROLS.flatMap((c) => c.keys);

  it("zawiera docelowe sterowanie i każdy klawisz tylko raz", () => {
    for (const k of ["W", "A", "S", "D", "Shift", "E", "I", "J", "M", "O", "F3", "Esc"]) expect(flat).toContain(k);
    expect(new Set(flat).size).toBe(flat.length);
  });
});
