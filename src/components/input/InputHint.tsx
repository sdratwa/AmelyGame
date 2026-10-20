"use client";

import type { HintAction } from "@/lib/input/actions";
import { cn } from "@/lib/utils";
import { useHint } from "./hooks";

/**
 * Podpowiedź przycisku zgodna z aktywnym urządzeniem: [E] / [✕] / [A]. Etykieta pochodzi z konfiguracji mapowania,
 * a nie z napisu wpisanego w komponencie. Brak odpowiednika (np. menu na klawiaturze) = nic nie renderujemy.
 */
export function InputHint({ action, className }: { action: HintAction; className?: string }) {
  const label = useHint(action);
  if (!label) return null;
  return (
    <kbd data-testid={`hint-${action}`} className={cn("rounded bg-black/25 px-1 text-[10px] font-semibold", className)}>
      {label}
    </kbd>
  );
}

/** Sama etykieta jako tekst (do zdań typu "Zamknięcie: J lub Esc"). */
export function HintText({ action, fallback }: { action: HintAction; fallback?: string }) {
  const label = useHint(action);
  return <>{label ?? fallback ?? ""}</>;
}
