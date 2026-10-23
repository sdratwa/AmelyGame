"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import type { ActionHandler, ActiveDevice, HintAction } from "@/lib/input/actions";
import { getInputHub } from "@/lib/input/browser";
import { controllerSettings, DEFAULT_CONTROLLER_SETTINGS, type ControllerSettings } from "@/lib/input/controllerSettings";
import type { PadStatus } from "@/lib/input/gamepadInput";
import { hintLabel } from "@/lib/input/prompts";
import { isTouchUi, parseTouchOverride, TOUCH_UI_STORAGE_KEY, type TouchOverride } from "@/lib/input/touchMode";
import { gameSettings, DEFAULT_GAME_SETTINGS, type GameSettings } from "@/lib/settings/gameSettings";
import { touchSettings, DEFAULT_TOUCH_SETTINGS, type TouchSettings } from "@/lib/input/touchSettings";

/** Subskrypcja akcji wejścia (pad; klawiatura korzysta z tych samych funkcji akcji w komponentach). */
export function useInputActions(handler: ActionHandler, priority = 0): void {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => getInputHub().subscribe((e) => ref.current(e), priority), [priority]);
}

/** Aktywne urządzenie (klawiatura / PlayStation / Xbox); zmienia się rzadko, więc nie obciąża renderowania. */
export function useInputDevice(): ActiveDevice {
  return useSyncExternalStore(
    (cb) => getInputHub().tracker.subscribe(cb),
    () => getInputHub().tracker.device,
    () => "keyboard",
  );
}

/** Etykieta podpowiedzi dla akcji zgodna z aktywnym urządzeniem (null = brak odpowiednika). */
export function useHint(action: HintAction): string | null {
  return hintLabel(action, useInputDevice());
}

export type GamepadInfo = { status: PadStatus; name: string };

export function useGamepadInfo(): GamepadInfo {
  useSyncExternalStore(
    (cb) => getInputHub().pad.subscribe(cb),
    () => getInputHub().pad.version,
    () => 0,
  );
  const pad = getInputHub().pad;
  return { status: pad.status, name: pad.name };
}

export function useControllerSettings(): ControllerSettings {
  return useSyncExternalStore(
    (cb) => controllerSettings.subscribe(cb),
    () => controllerSettings.get(),
    () => DEFAULT_CONTROLLER_SETTINGS,
  );
}

let touchOverride: TouchOverride | undefined;

function readTouchOverride(): TouchOverride {
  if (touchOverride === undefined) {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(TOUCH_UI_STORAGE_KEY);
    } catch {
      stored = null;
    }
    touchOverride = parseTouchOverride(window.location.search, stored);
  }
  return touchOverride;
}

function touchUiSnapshot(): boolean {
  return isTouchUi({
    coarsePointer: window.matchMedia("(pointer: coarse)").matches,
    hoverNone: window.matchMedia("(hover: none)").matches,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    minDim: Math.min(window.innerWidth, window.innerHeight),
    override: readTouchOverride(),
  });
}

function subscribeTouchUi(cb: () => void): () => void {
  const queries = [window.matchMedia("(pointer: coarse)"), window.matchMedia("(hover: none)")];
  for (const q of queries) q.addEventListener("change", cb);
  window.addEventListener("resize", cb);
  window.addEventListener("orientationchange", cb);
  return () => {
    for (const q of queries) q.removeEventListener("change", cb);
    window.removeEventListener("resize", cb);
    window.removeEventListener("orientationchange", cb);
  };
}

/**
 * Tryb interfejsu dotykowego (telefon): możliwości urządzenia + rozmiar ekranu (patrz `touchMode.ts`), nie sama szerokość
 * okna. Zwraca boolean, więc resize (np. zwijanie paska Safari) nie powoduje renderów, dopóki tryb się nie zmieni.
 */
export function useTouchUi(): boolean {
  return useSyncExternalStore(subscribeTouchUi, touchUiSnapshot, () => false);
}

export function useGameSettings(): GameSettings {
  return useSyncExternalStore(
    (cb) => gameSettings.subscribe(cb),
    () => gameSettings.get(),
    () => DEFAULT_GAME_SETTINGS,
  );
}

export function useTouchSettings(): TouchSettings {
  return useSyncExternalStore(
    (cb) => touchSettings.subscribe(cb),
    () => touchSettings.get(),
    () => DEFAULT_TOUCH_SETTINGS,
  );
}
