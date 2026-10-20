import { controllerSettings } from "./controllerSettings";
import { DeviceTracker } from "./deviceTracker";
import { createNavigatorHandler, isModalOpen, watchModals } from "./domNavigator";
import { GamepadInput, type GamepadLike } from "./gamepadInput";
import { playHaptic, type HapticKind } from "./haptics";
import { InputHub } from "./inputHub";
import { ModalGrace } from "./uiNav";

/**
 * Powiązanie huba wejścia z przeglądarką: singleton, nasłuch zdarzeń DOM (klawiatura, mysz, pad), zapasowa pętla
 * odczytu poza lasem i nawigacja po interfejsie. Moduł jest bezpieczny przy renderowaniu po stronie serwera
 * (nic nie dotyka DOM przy imporcie ani przy tworzeniu huba).
 */

function readGamepads(): ArrayLike<GamepadLike | null> {
  if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") return [];
  return navigator.getGamepads() as unknown as ArrayLike<GamepadLike | null>;
}

/** Kontekst aplikacji: czy gracz steruje wolnym lasem (bez okien i menu). Reszta to tryb interfejsu. */
let freeForest = false;

export function setFreeForest(value: boolean): void {
  freeForest = value;
}

let hub: InputHub | null = null;

export function getInputHub(): InputHub {
  hub ??= new InputHub({
    pad: new GamepadInput(readGamepads),
    tracker: new DeviceTracker(),
    settings: () => controllerSettings.get(),
    isUiMode: () => {
      if (!freeForest) return true;
      return typeof document !== "undefined" && isModalOpen();
    },
  });
  return hub;
}

/**
 * Uruchamia nasłuch w przeglądarce; zwraca funkcję sprzątającą. Zapasowa pętla rAF działa tylko, gdy pad jest podłączony
 * i żaden inny odbiorca (renderer lasu) nie pompuje wejścia w swojej pętli.
 */
export function startBrowserInput(): () => void {
  const h = getInputHub();
  const tracker = h.tracker;
  const pad = h.pad;
  const grace = new ModalGrace();
  const stopWatching = watchModals(grace);
  const unsubscribeNav = h.subscribe(createNavigatorHandler(grace), 100);
  const root = document.documentElement;
  const setAttr = () => {
    root.dataset.input = tracker.device === "keyboard" ? "keyboard" : "pad";
  };
  setAttr();
  const unsubscribeTracker = tracker.subscribe(setAttr);

  let raf = 0;
  const loop = (t: number) => {
    raf = 0;
    if (h.hasDriver || pad.status !== "ready") return; // pętlę przejął renderer albo pada nie ma
    h.pump(t);
    if (pad.status === "ready") raf = requestAnimationFrame(loop);
  };
  const ensureLoop = () => {
    if (raf === 0 && !h.hasDriver && pad.status === "ready") raf = requestAnimationFrame(loop);
  };
  const unsubscribePad = pad.subscribe(ensureLoop);
  const unsubscribeDriver = h.onDriverDetached(ensureLoop);

  const onConnect = () => {
    pad.refresh(performance.now());
    ensureLoop();
  };
  const onDisconnect = (e: Event) => pad.disconnect((e as GamepadEvent).gamepad.index);
  // Zdarzenia syntetyczne (np. Esc z nawigacji padem) nie są użyciem klawiatury.
  const onKey = (e: KeyboardEvent) => {
    if (e.isTrusted) tracker.noteKeyboard(performance.now());
  };
  const onMouseDown = (e: MouseEvent) => {
    if (e.isTrusted) tracker.noteMouseDown(performance.now());
  };
  const onMouseMove = (e: MouseEvent) => e.isTrusted && tracker.noteMouseMove(performance.now(), Math.abs(e.movementX) + Math.abs(e.movementY));
  window.addEventListener("gamepadconnected", onConnect);
  window.addEventListener("gamepaddisconnected", onDisconnect);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("mousedown", onMouseDown, true);
  window.addEventListener("mousemove", onMouseMove, true);

  // Pad podłączony przed uruchomieniem gry: część przeglądarek udostępnia go od razu.
  pad.refresh(performance.now());
  ensureLoop();

  return () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    window.removeEventListener("gamepadconnected", onConnect);
    window.removeEventListener("gamepaddisconnected", onDisconnect);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("mousedown", onMouseDown, true);
    window.removeEventListener("mousemove", onMouseMove, true);
    unsubscribePad();
    unsubscribeDriver();
    unsubscribeTracker();
    unsubscribeNav();
    stopWatching();
  };
}

/** Wibracja pada (opcjonalna): tylko gdy gracz faktycznie używa pada i włączył wibracje w ustawieniach. */
export function rumble(kind: HapticKind): void {
  if (!hub || hub.tracker.device === "keyboard") return;
  playHaptic(hub.pad.actuator, kind, controllerSettings.get().vibration);
}
