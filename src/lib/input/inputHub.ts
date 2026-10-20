import {
  NAV_ACTION,
  type ActionEvent,
  type ActionHandler,
  type InputAction,
  type InputSource,
  type NavDirection,
} from "./actions";
import { pitchRate, shapeLook, shapeMove, yawRate, type Vec2 } from "./analog";
import type { ControllerSettings } from "./controllerSettings";
import type { DeviceTracker } from "./deviceTracker";
import {
  BTN,
  BUTTON_BINDINGS,
  INTERACT_GATE_MS,
  NAV_DELAY_MS,
  NAV_REPEAT_MS,
  NAV_STICK_OFF,
  NAV_STICK_ON,
  SPRINT_BUTTON,
} from "./gamepadConfig";
import type { GamepadInput } from "./gamepadInput";

export type InputHubDeps = {
  pad: GamepadInput;
  tracker: DeviceTracker;
  settings: () => ControllerSettings;
  /**
   * Czy wejście ma teraz sterować interfejsem (okno, miasto, sklep, menu) zamiast grą. `fresh` = true przy
   * krawędziach przycisków (sprawdzenie dokładne); false przy ciągłej nawigacji (wynik może pochodzić z pamięci
   * podręcznej).
   */
  isUiMode: (fresh: boolean) => boolean;
};

/** Jedno naciśnięcie = jedna interakcja, także gdy jednocześnie użyto klawiatury i pada. */
export class InteractGate {
  private last = -Infinity;

  constructor(private readonly windowMs: number = INTERACT_GATE_MS) {}

  /**
   * Uruchamia `fn` (zwraca true, gdy interakcja zaszła). Jeśli niedawno była już interakcja z innego źródła, wywołanie
   * jest połykane (zwraca true, aby nic innego, np. jedzenie, nie zareagowało na ten sam impuls).
   */
  run(now: number, fn: () => boolean): boolean {
    if (now - this.last < this.windowMs) return true;
    const handled = fn();
    if (handled) this.last = now;
    return handled;
  }
}

type Registered = { fn: ActionHandler; priority: number };

const NAV_DIRS: readonly NavDirection[] = ["up", "down", "left", "right"];
const NAV_BUTTONS = [BTN.up, BTN.down, BTN.left, BTN.right];
const UI_CACHE_MS = 120;

/**
 * Centralny punkt wejścia: czyta pada (jedno wywołanie `pump` na klatkę), udostępnia osie (MOVE, LOOK, SPRINT) bez
 * alokacji i rozsyła akcje jednorazowe do handlerów. Klawiatura i mysz korzystają z tych samych handlerów (`emit`) lub
 * dalej z własnych zdarzeń DOM, ale wywołują te same funkcje akcji w komponentach.
 */
export class InputHub {
  /** Wejście ruchu po deadzone i krzywej: `x` w prawo, `y` do przodu; długość <= 1. */
  readonly move: Vec2 = { x: 0, y: 0 };
  /** Wejście kamery: `x` w prawo, `y` w dół (po ewentualnym odwróceniu osi). */
  readonly look: Vec2 = { x: 0, y: 0 };
  sprint = false;
  /** Prędkości obrotu kamery (rad/s przy pełnym wychyleniu) z bieżących ustawień. */
  lookYawRate = yawRate(1);
  lookPitchRate = pitchRate(1);
  readonly interactGate = new InteractGate();

  private readonly handlers: Registered[] = [];
  private lastPump = -Infinity;
  private drivers = 0;
  private uiCache = false;
  private uiCacheAt = -Infinity;
  private readonly navHeld = new Uint8Array(4);
  private readonly navNext = new Float64Array(4);
  private stickDir = -1;
  private readonly driverSubs = new Set<() => void>();

  constructor(private readonly deps: InputHubDeps) {
    deps.pad.subscribe(() => {
      if (deps.pad.status === "ready") deps.tracker.setPadFamily(deps.pad.family);
      else deps.tracker.padLost();
    });
  }

  get pad(): GamepadInput {
    return this.deps.pad;
  }

  get tracker(): DeviceTracker {
    return this.deps.tracker;
  }

  /** Czy ktoś inny (np. renderer lasu) już pompuje wejście w swojej pętli; wtedy zapasowa pętla UI nie jest potrzebna. */
  get hasDriver(): boolean {
    return this.drivers > 0;
  }

  /** Rejestruje zewnętrzną pętlę (renderer); zwraca funkcję wyrejestrowania. */
  attachDriver(): () => void {
    this.drivers++;
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.drivers--;
      for (const cb of this.driverSubs) cb();
    };
  }

  /** Powiadamia o odłączeniu zewnętrznej pętli (wtedy zapasowa pętla UI może wystartować). */
  onDriverDetached(cb: () => void): () => void {
    this.driverSubs.add(cb);
    return () => {
      this.driverSubs.delete(cb);
    };
  }

  subscribe(fn: ActionHandler, priority = 0): () => void {
    const entry: Registered = { fn, priority };
    let at = this.handlers.findIndex((h) => h.priority < priority);
    if (at < 0) at = this.handlers.length;
    this.handlers.splice(at, 0, entry);
    return () => {
      const i = this.handlers.indexOf(entry);
      if (i >= 0) this.handlers.splice(i, 1);
    };
  }

  /** Rozsyła akcję do handlerów (od najwyższego priorytetu); zwraca true, jeśli któryś ją obsłużył. */
  emit(action: InputAction, source: InputSource, time: number): boolean {
    const event: ActionEvent = { action, source, time };
    for (const h of [...this.handlers]) {
      if (h.fn(event) === true) return true;
    }
    return false;
  }

  /** Jedno odczytanie pada. Wielokrotne wywołanie z tym samym czasem jest ignorowane (kilku "kierowców" w jednej klatce). */
  pump(now: number): void {
    if (now === this.lastPump) return;
    this.lastPump = now;
    const pad = this.deps.pad;
    pad.poll(now);

    if (pad.status !== "ready") {
      this.clearOutputs();
      return;
    }

    const tracker = this.deps.tracker;
    if (pad.pressedCount > 0) tracker.notePadButton(now);
    tracker.notePadStick(now, pad.stickMax);

    const s = this.deps.settings();
    this.lookYawRate = yawRate(s.cameraSensitivityX);
    this.lookPitchRate = pitchRate(s.cameraSensitivityY);
    shapeMove(pad.leftX, pad.leftY, s.leftDeadzone, this.move);
    shapeLook(pad.rightX, pad.rightY, s.rightDeadzone, s.invertY, this.look);
    this.sprint = pad.isDown(SPRINT_BUTTON);

    let ui: boolean | null = null;
    if (pad.pressedCount > 0) {
      ui = this.deps.isUiMode(true);
      this.uiCache = ui;
      this.uiCacheAt = now;
      for (const b of BUTTON_BINDINGS) {
        if (pad.pressed[b.button] !== 1) continue;
        if (ui && b.repeat) continue;
        const action = ui ? b.ui : b.game;
        if (action) this.emit(action, "gamepad", now);
      }
    }
    this.pumpNavigation(now, ui);
  }

  /** Zeruje osie i stan nawigacji (np. brak pada). */
  private clearOutputs(): void {
    this.move.x = this.move.y = 0;
    this.look.x = this.look.y = 0;
    this.sprint = false;
    this.navHeld.fill(0);
    this.stickDir = -1;
  }

  private cachedUi(now: number): boolean {
    if (now - this.uiCacheAt > UI_CACHE_MS) {
      this.uiCache = this.deps.isUiMode(false);
      this.uiCacheAt = now;
    }
    return this.uiCache;
  }

  /** Nawigacja po interfejsie: D-pad i lewy analog z opóźnieniem pierwszego powtórzenia i histerezą progów. */
  private pumpNavigation(now: number, knownUi: boolean | null): void {
    const pad = this.deps.pad;
    const dpadHeld =
      pad.down[BTN.up] === 1 || pad.down[BTN.down] === 1 || pad.down[BTN.left] === 1 || pad.down[BTN.right] === 1;
    const stickActive = Math.hypot(pad.leftX, pad.leftY) > NAV_STICK_OFF;
    if (!dpadHeld && !stickActive) {
      if (this.stickDir !== -1 || this.navHeld[0] + this.navHeld[1] + this.navHeld[2] + this.navHeld[3] > 0) {
        this.navHeld.fill(0);
        this.stickDir = -1;
      }
      return;
    }
    const ui = knownUi ?? this.cachedUi(now);
    if (!ui) {
      // W grze D-pad działa jednorazowo (sloty), a lewy analog jest ruchem; nic nie powtarzamy.
      this.navHeld.fill(0);
      this.stickDir = -1;
      return;
    }

    // Kierunek lewego analogu (dominująca oś) z histerezą progów.
    const threshold = this.stickDir >= 0 ? NAV_STICK_OFF : NAV_STICK_ON;
    let stick = -1;
    if (Math.hypot(pad.leftX, pad.leftY) >= threshold) {
      if (Math.abs(pad.leftX) >= Math.abs(pad.leftY)) stick = pad.leftX > 0 ? 3 : 2;
      else stick = pad.leftY > 0 ? 1 : 0;
    }
    this.stickDir = stick;

    for (let i = 0; i < 4; i++) {
      const held = pad.down[NAV_BUTTONS[i]] === 1 || stick === i;
      if (!held) {
        this.navHeld[i] = 0;
        continue;
      }
      if (this.navHeld[i] === 0) {
        this.navHeld[i] = 1;
        this.navNext[i] = now + NAV_DELAY_MS;
        this.fireNav(NAV_DIRS[i], now);
      } else if (now >= this.navNext[i]) {
        this.navNext[i] = now + NAV_REPEAT_MS;
        this.fireNav(NAV_DIRS[i], now);
      }
    }
  }

  private fireNav(dir: NavDirection, now: number): void {
    this.emit(NAV_ACTION[dir], "gamepad", now);
  }
}
