import { describe, expect, it } from "vitest";
import { BTN, BUTTON_BINDINGS, BUTTON_GLYPHS, SPRINT_BUTTON, TPP_BUTTONS, buttonForHint, padFamilyFromId } from "./gamepadConfig";
import { hintLabel, padForestHelp } from "./prompts";

describe("mapowanie przycisków", () => {
  it("Cross/A to skok w grze (bez akcji huba) i zatwierdzanie w interfejsie; interakcja jest na Square/X", () => {
    const b = BUTTON_BINDINGS.find((x) => x.button === BTN.cross);
    expect(b?.game).toBeUndefined();
    expect(b?.ui).toBe("confirm");
    expect(TPP_BUTTONS.jump).toBe(BTN.cross);
    expect(TPP_BUTTONS.crouch).toBe(BTN.circle);
    const sq = BUTTON_BINDINGS.find((x) => x.button === BTN.square);
    expect(sq?.game).toBe("interact");
    expect(sq?.ui).toBe("journal");
  });

  it("Circle/B cofa tylko w interfejsie (w wolnym lesie nie wychodzi z gry)", () => {
    const b = BUTTON_BINDINGS.find((x) => x.button === BTN.circle);
    expect(b?.ui).toBe("cancel");
    expect(b?.game).toBeUndefined();
  });

  it("Triangle/Y = ekwipunek, L2/LT = dziennik w lesie, L1 = minimapa, Options = pauza, L3 = bieg", () => {
    const by = (button: number) => BUTTON_BINDINGS.find((x) => x.button === button);
    expect(by(BTN.triangle)?.game).toBe("inventory");
    expect(by(BTN.l2)?.game).toBe("journal");
    expect(by(BTN.l1)?.game).toBe("minimap");
    expect(by(BTN.options)?.game).toBe("pause");
    expect(SPRINT_BUTTON).toBe(BTN.l3);
  });

  it("D-pad nawiguje w interfejsie, a lewo/prawo zmienia slot w grze", () => {
    const by = (button: number) => BUTTON_BINDINGS.find((x) => x.button === button);
    expect(by(BTN.up)?.ui).toBe("navUp");
    expect(by(BTN.down)?.ui).toBe("navDown");
    expect(by(BTN.left)?.ui).toBe("navLeft");
    expect(by(BTN.right)?.ui).toBe("navRight");
    expect(by(BTN.left)?.game).toBe("slotPrev");
    expect(by(BTN.right)?.game).toBe("slotNext");
  });

  it("żaden przycisk nie występuje w tabeli dwa razy", () => {
    const buttons = BUTTON_BINDINGS.map((b) => b.button);
    expect(new Set(buttons).size).toBe(buttons.length);
  });

  it("R1/R2 wybierają slot", () => {
    expect(buttonForHint("slotPrev")).toBe(BTN.r1);
    expect(buttonForHint("slotNext")).toBe(BTN.r2);
  });
});

describe("rodzina kontrolera i podpowiedzi", () => {
  it("rozpoznaje DualSense i Xbox po id, reszta jest ogólna", () => {
    expect(padFamilyFromId("DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)")).toBe("playstation");
    expect(padFamilyFromId("Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)")).toBe("xbox");
    expect(padFamilyFromId("Some Pad")).toBe("generic");
  });

  it("interakcja: [E] na klawiaturze, [□] na PlayStation, [X] na Xbox; skok [Spacja]/[✕]/[A], kucanie [C]/[○]/[B]", () => {
    expect(hintLabel("interact", "keyboard")).toBe("E");
    expect(hintLabel("interact", "playstation")).toBe("□");
    expect(hintLabel("interact", "xbox")).toBe("X");
    expect(hintLabel("jump", "keyboard")).toBe("Spacja");
    expect(hintLabel("jump", "playstation")).toBe("✕");
    expect(hintLabel("jump", "xbox")).toBe("A");
    expect(hintLabel("crouch", "keyboard")).toBe("C");
    expect(hintLabel("crouch", "playstation")).toBe("○");
    expect(hintLabel("crouch", "xbox")).toBe("B");
    expect(hintLabel("confirm", "playstation")).toBe("✕");
  });

  it("pozostałe podpowiedzi wynikają z mapowania", () => {
    expect(hintLabel("inventory", "keyboard")).toBe("I");
    expect(hintLabel("inventory", "playstation")).toBe("△");
    expect(hintLabel("inventory", "xbox")).toBe("Y");
    expect(hintLabel("journal", "playstation")).toBe("L2");
    expect(hintLabel("journal", "xbox")).toBe("LT");
    expect(hintLabel("cancel", "playstation")).toBe("○");
    expect(hintLabel("cancel", "xbox")).toBe("B");
    expect(hintLabel("minimap", "playstation")).toBe("L1");
    expect(hintLabel("pause", "keyboard")).toBeNull();
    expect(hintLabel("pause", "playstation")).toBe("OPTIONS");
  });

  it("każdy glif używany w mapowaniu istnieje dla obu rodzin", () => {
    for (const b of BUTTON_BINDINGS) {
      expect(BUTTON_GLYPHS.playstation[b.button]).toBeTruthy();
      expect(BUTTON_GLYPHS.xbox[b.button]).toBeTruthy();
    }
  });

  it("pomoc dla pada zawiera ruch, interakcję i menu", () => {
    const help = padForestHelp("playstation");
    const labels = help.map((h) => h.label);
    expect(labels).toContain("ruch");
    expect(labels).toContain("interakcja");
    expect(labels).toContain("skok");
    expect(labels).toContain("kucanie");
    expect(labels).toContain("menu");
  });
});
