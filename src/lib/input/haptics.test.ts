import { describe, expect, it } from "vitest";
import { HAPTIC_PRESETS, playHaptic } from "./haptics";

describe("haptyka", () => {
  it("brak aktuatora lub wyłączone wibracje = brak efektu, bez błędu", () => {
    expect(playHaptic(null, "chest", true)).toBe(false);
    expect(playHaptic(undefined, "chest", true)).toBe(false);
    expect(playHaptic({ playEffect: () => undefined }, "chest", false)).toBe(false);
  });

  it("zleca delikatny efekt dual-rumble", () => {
    const calls: { type: string; params: Record<string, number> }[] = [];
    const ok = playHaptic({ playEffect: (type: string, params: Record<string, number>) => void calls.push({ type, params }) }, "bridge", true);
    expect(ok).toBe(true);
    expect(calls[0].type).toBe("dual-rumble");
    expect(calls[0].params.duration).toBe(HAPTIC_PRESETS.bridge.duration);
    expect(calls[0].params.strongMagnitude).toBeLessThanOrEqual(0.5);
    expect(calls[0].params.weakMagnitude).toBeLessThanOrEqual(0.5);
  });

  it("wyjątek lub odrzucona obietnica nie przerywa gry", () => {
    expect(
      playHaptic(
        {
          playEffect: () => {
            throw new Error("nie wspierane");
          },
        },
        "item",
        true,
      ),
    ).toBe(false);
    expect(playHaptic({ playEffect: () => Promise.reject(new Error("x")) }, "item", true)).toBe(true);
  });

  it("starsze API pulse jest używane jako zapas", () => {
    let pulsed = 0;
    expect(playHaptic({ pulse: () => void pulsed++ }, "chest", true)).toBe(true);
    expect(pulsed).toBe(1);
  });

  it("wszystkie efekty są krótkie i delikatne", () => {
    for (const p of Object.values(HAPTIC_PRESETS)) {
      expect(p.duration).toBeLessThanOrEqual(400);
      expect(Math.max(p.weak, p.strong)).toBeLessThanOrEqual(0.5);
    }
  });
});
