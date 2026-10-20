"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import type { ActionHandler, ActiveDevice, HintAction } from "@/lib/input/actions";
import { getInputHub } from "@/lib/input/browser";
import { controllerSettings, DEFAULT_CONTROLLER_SETTINGS, type ControllerSettings } from "@/lib/input/controllerSettings";
import type { PadStatus } from "@/lib/input/gamepadInput";
import { hintLabel } from "@/lib/input/prompts";

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
