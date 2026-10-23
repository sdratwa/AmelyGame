"use client";

import type { HintAction } from "@/lib/input/actions";
import { cn } from "@/lib/utils";
import { hintLabel } from "@/lib/input/prompts";
import { useInputDevice, useTouchUi } from "./hooks";

/**
 * Podpowiedź przycisku zgodna z aktywnym urządzeniem: [E] / [✕] / [A]. Etykieta pochodzi z konfiguracji mapowania,
 * a nie z napisu wpisanego w komponencie. Brak odpowiednika (np. menu na klawiaturze) = nic nie renderujemy.
 */
export function InputHint({ action, padAction, className }: { action: HintAction; padAction?: HintAction; className?: string }) {
  const device = useInputDevice();
  const touch = useTouchUi();
  // `padAction`: na padzie ta sama czynność ma inny przycisk (np. okno skrzyni: E na klawiaturze, zatwierdzenie na padzie).
  const label = hintLabel(device === "keyboard" ? action : (padAction ?? action), device);
  // Na telefonie nie ma klawiszy ani przycisków pada: podpowiedzi zastępują przyciski ekranowe.
  if (!label || touch) return null;
  return (
    <kbd data-testid={`hint-${action}`} className={cn("rounded bg-black/25 px-1 text-[10px] font-semibold", className)}>
      {label}
    </kbd>
  );
}

/** Sama etykieta jako tekst (do zdań typu "Zamknięcie: J lub Esc"). */
export function HintText({ action, fallback }: { action: HintAction; fallback?: string }) {
  const label = hintLabel(action, useInputDevice());
  return <>{label ?? fallback ?? ""}</>;
}
