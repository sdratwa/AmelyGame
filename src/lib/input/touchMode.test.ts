import { describe, expect, it } from "vitest";
import { isTouchUi, parseTouchOverride, type TouchEnv } from "./touchMode";

const phone: TouchEnv = { coarsePointer: true, hoverNone: true, maxTouchPoints: 5, minDim: 390, override: null };

describe("isTouchUi", () => {
  it("telefon (dotyk, bez hover, mały ekran) dostaje tryb dotykowy", () => {
    expect(isTouchUi(phone)).toBe(true);
  });

  it("desktop z myszą nie dostaje trybu dotykowego, także przy wąskim oknie", () => {
    expect(isTouchUi({ ...phone, coarsePointer: false, hoverNone: false, maxTouchPoints: 0, minDim: 300 })).toBe(false);
  });

  it("laptop z ekranem dotykowym i myszą (hover) zostaje przy interfejsie desktopowym", () => {
    expect(isTouchUi({ ...phone, hoverNone: false, coarsePointer: false })).toBe(false);
  });

  it("duży ekran dotykowy (tablet) jest poza pierwszą wersją", () => {
    expect(isTouchUi({ ...phone, minDim: 820 })).toBe(false);
  });

  it("brak punktów dotyku wyklucza tryb", () => {
    expect(isTouchUi({ ...phone, maxTouchPoints: 0 })).toBe(false);
  });

  it("override wymusza tryb w obie strony", () => {
    expect(isTouchUi({ ...phone, override: "off" })).toBe(false);
    expect(isTouchUi({ ...phone, coarsePointer: false, hoverNone: false, maxTouchPoints: 0, minDim: 1200, override: "on" })).toBe(true);
  });
});

describe("parseTouchOverride", () => {
  it("parametr zapytania ma pierwszeństwo przed zapisem", () => {
    expect(parseTouchOverride("?touch=1", "off")).toBe("on");
    expect(parseTouchOverride("?touch=0", "on")).toBe("off");
  });

  it("bez parametru używa zapisu, a przy śmieciach nic nie wymusza", () => {
    expect(parseTouchOverride("", "on")).toBe("on");
    expect(parseTouchOverride("?touch=abc", "xyz")).toBeNull();
    expect(parseTouchOverride(null, null)).toBeNull();
  });
});
