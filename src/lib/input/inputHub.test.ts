import { describe, expect, it } from "vitest";
import type { ActionEvent, InputAction } from "./actions";
import { DEFAULT_CONTROLLER_SETTINGS } from "./controllerSettings";
import { DeviceTracker } from "./deviceTracker";
import { BTN, NAV_DELAY_MS, NAV_REPEAT_MS } from "./gamepadConfig";
import { GamepadInput } from "./gamepadInput";
import { InputHub, InteractGate } from "./inputHub";
import { makePad, makeReader } from "./padTestkit";

function setup(ui = false) {
  const pad = makePad();
  const reader = makeReader([pad]);
  const input = new GamepadInput(reader.read);
  const mode = { ui };
  const hub = new InputHub({
    pad: input,
    tracker: new DeviceTracker(),
    settings: () => DEFAULT_CONTROLLER_SETTINGS,
    isUiMode: () => mode.ui,
  });
  const events: InputAction[] = [];
  hub.subscribe((e: ActionEvent) => {
    events.push(e.action);
  });
  let t = 0;
  const frame = (ms = 16) => {
    t += ms;
    hub.pump(t);
  };
  return { pad, reader, input, hub, mode, events, frame, now: () => t };
}

describe("InputHub: akcje jednorazowe", () => {
  it("Cross w grze = interakcja, w interfejsie = zatwierdzenie", () => {
    const s = setup(false);
    s.frame();
    s.pad.press(BTN.cross);
    s.frame();
    expect(s.events).toEqual(["interact"]);
    s.pad.release(BTN.cross);
    s.frame();
    s.mode.ui = true;
    s.pad.press(BTN.cross);
    s.frame();
    expect(s.events).toEqual(["interact", "confirm"]);
  });

  it("jedno naciśnięcie = jedna akcja: przytrzymanie nie powtarza interakcji", () => {
    const s = setup(false);
    s.frame();
    s.pad.press(BTN.cross);
    for (let i = 0; i < 30; i++) s.frame();
    expect(s.events).toEqual(["interact"]);
  });

  it("Triangle, Square, L1, Options w grze", () => {
    const s = setup(false);
    s.frame();
    for (const b of [BTN.triangle, BTN.square, BTN.l1, BTN.options]) {
      s.pad.press(b);
      s.frame();
      s.pad.release(b);
      s.frame();
    }
    expect(s.events).toEqual(["inventory", "journal", "minimap", "pause"]);
  });

  it("Circle w wolnym lesie nic nie robi, w interfejsie cofa", () => {
    const s = setup(false);
    s.frame();
    s.pad.press(BTN.circle);
    s.frame();
    expect(s.events).toEqual([]);
    s.pad.release(BTN.circle);
    s.frame();
    s.mode.ui = true;
    s.pad.press(BTN.circle);
    s.frame();
    expect(s.events).toEqual(["cancel"]);
  });

  it("R1/R2 oraz D-pad lewo/prawo zmieniają slot w grze", () => {
    const s = setup(false);
    s.frame();
    for (const b of [BTN.r1, BTN.r2, BTN.left, BTN.right]) {
      s.pad.press(b);
      s.frame();
      s.pad.release(b);
      s.frame();
    }
    expect(s.events).toEqual(["slotPrev", "slotNext", "slotPrev", "slotNext"]);
  });

  it("handler o wyższym priorytecie, który obsłużył akcję, blokuje niższe (dialog przejmuje wejście)", () => {
    const s = setup(false);
    const seenHigh: InputAction[] = [];
    s.hub.subscribe((e) => {
      seenHigh.push(e.action);
      return true;
    }, 10);
    s.frame();
    s.pad.press(BTN.cross);
    s.frame();
    expect(seenHigh).toEqual(["interact"]);
    expect(s.events).toEqual([]);
  });

  it("wyrejestrowanie handlera działa", () => {
    const s = setup(false);
    const got: InputAction[] = [];
    const off = s.hub.subscribe((e) => {
      got.push(e.action);
    });
    off();
    s.frame();
    s.pad.press(BTN.cross);
    s.frame();
    expect(got).toEqual([]);
  });

  it("wielokrotne pump z tym samym czasem czyta pada raz (kilka pętli w jednej klatce)", () => {
    const s = setup(false);
    s.hub.pump(100);
    s.pad.press(BTN.cross);
    s.hub.pump(116);
    s.hub.pump(116);
    expect(s.events).toEqual(["interact"]);
  });
});

describe("InputHub: nawigacja po interfejsie", () => {
  it("D-pad: pierwsze naciśnięcie od razu, potem po opóźnieniu i z autopowtarzaniem", () => {
    const s = setup(true);
    s.frame();
    s.pad.press(BTN.down);
    s.frame();
    expect(s.events).toEqual(["navDown"]);
    const start = s.now();
    while (s.now() - start < NAV_DELAY_MS - 20) s.frame();
    expect(s.events).toEqual(["navDown"]);
    while (s.now() - start < NAV_DELAY_MS + NAV_REPEAT_MS + 40) s.frame();
    expect(s.events.length).toBeGreaterThanOrEqual(2);
    expect(s.events.every((a) => a === "navDown")).toBe(true);
  });

  it("lewy analog nawiguje w interfejsie (z histerezą), ale w grze jest tylko ruchem", () => {
    const s = setup(true);
    s.frame();
    s.pad.setAxes(0, 0.9);
    s.frame();
    expect(s.events).toEqual(["navDown"]);
    s.pad.setAxes(0, 0);
    for (let i = 0; i < 12; i++) s.frame(); // pamięć podręczna trybu interfejsu wygasa po ~120 ms
    s.mode.ui = false;
    s.pad.setAxes(0, 0.9);
    for (let i = 0; i < 40; i++) s.frame();
    expect(s.events).toEqual(["navDown"]);
  });

  it("słabe wychylenie analogu (dryf) nie nawiguje", () => {
    const s = setup(true);
    s.frame();
    s.pad.setAxes(0.3, 0.3);
    for (let i = 0; i < 20; i++) s.frame();
    expect(s.events).toEqual([]);
  });
});

describe("InputHub: osie", () => {
  it("lewy analog w górę = ruch do przodu, puszczony = zero", () => {
    const s = setup(false);
    s.pad.setAxes(0, -1);
    s.frame();
    expect(s.hub.move.y).toBeGreaterThan(0.9);
    s.pad.setAxes(0.05, -0.05);
    s.frame();
    expect(s.hub.move.x).toBe(0);
    expect(s.hub.move.y).toBe(0);
  });

  it("prawy analog steruje kamerą niezależnie od ruchu", () => {
    const s = setup(false);
    s.pad.setAxes(0, 0, 1, 0);
    s.frame();
    expect(s.hub.look.x).toBeGreaterThan(0.9);
    expect(s.hub.move.x).toBe(0);
  });

  it("L3 = bieg, tylko dopóki jest trzymany", () => {
    const s = setup(false);
    s.pad.press(BTN.l3);
    s.frame();
    expect(s.hub.sprint).toBe(true);
    s.pad.release(BTN.l3);
    s.frame();
    expect(s.hub.sprint).toBe(false);
  });

  it("rozłączenie pada zeruje osie i bieg", () => {
    const s = setup(false);
    s.pad.setAxes(0, -1, 1, 1);
    s.pad.press(BTN.l3);
    s.frame();
    expect(s.hub.move.y).toBeGreaterThan(0);
    s.input.disconnect(0);
    s.reader.pads = [];
    s.frame();
    expect(s.hub.move).toEqual({ x: 0, y: 0 });
    expect(s.hub.look).toEqual({ x: 0, y: 0 });
    expect(s.hub.sprint).toBe(false);
  });

  it("aktywny pad przełącza podpowiedzi, a jego utrata wraca do klawiatury", () => {
    const s = setup(false);
    s.frame();
    s.pad.press(BTN.cross);
    s.frame();
    expect(s.hub.tracker.device).toBe("playstation");
    s.input.disconnect(0);
    expect(s.hub.tracker.device).toBe("keyboard");
  });
});

describe("InputHub: pętle odczytu", () => {
  it("śledzi zewnętrznego kierowcę (renderer) i powiadamia o jego odłączeniu", () => {
    const s = setup(false);
    expect(s.hub.hasDriver).toBe(false);
    let detached = 0;
    s.hub.onDriverDetached(() => detached++);
    const off = s.hub.attachDriver();
    expect(s.hub.hasDriver).toBe(true);
    off();
    off();
    expect(s.hub.hasDriver).toBe(false);
    expect(detached).toBe(1);
  });
});

describe("InteractGate", () => {
  it("drugie źródło w krótkim oknie nie powoduje podwójnej interakcji", () => {
    const gate = new InteractGate(150);
    let runs = 0;
    const act = () => {
      runs++;
      return true;
    };
    expect(gate.run(1000, act)).toBe(true);
    expect(gate.run(1050, act)).toBe(true); // połknięte
    expect(runs).toBe(1);
    expect(gate.run(1200, act)).toBe(true);
    expect(runs).toBe(2);
  });

  it("nieobsłużona interakcja nie zajmuje bramki", () => {
    const gate = new InteractGate(150);
    expect(gate.run(1000, () => false)).toBe(false);
    let runs = 0;
    gate.run(1010, () => {
      runs++;
      return true;
    });
    expect(runs).toBe(1);
  });
});
