"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { controllerSettings, roundTo, SETTING_LIMITS, type ControllerSettings } from "@/lib/input/controllerSettings";
import { HintText } from "@/components/input/InputHint";
import { useControllerSettings, useGamepadInfo } from "@/components/input/hooks";

type NumericKey = "cameraSensitivityX" | "cameraSensitivityY" | "leftDeadzone" | "rightDeadzone";

function Stepper({
  id,
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2" data-testid={`setting-${id}`}>
      <span className="text-sm text-slate-200">{label}</span>
      <span className="flex items-center gap-1.5">
        <Button type="button" size="icon" variant="secondary" aria-label={`${label}: mniej`} data-testid={`setting-${id}-dec`} onClick={() => onChange(Math.max(min, roundTo(value - step, step)))}>
          −
        </Button>
        <span data-testid={`setting-${id}-value`} className="w-12 text-center text-sm font-semibold tabular-nums" aria-live="polite">
          {format(value)}
        </span>
        <Button type="button" size="icon" variant="secondary" aria-label={`${label}: więcej`} data-testid={`setting-${id}-inc`} onClick={() => onChange(Math.min(max, roundTo(value + step, step)))}>
          +
        </Button>
      </span>
    </div>
  );
}

function Toggle({ id, label, on, onChange }: { id: string; label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm text-slate-200">{label}</span>
      <Button type="button" variant={on ? "default" : "secondary"} aria-pressed={on} data-testid={`setting-${id}`} onClick={() => onChange(!on)} className="w-20">
        {on ? "Włączone" : "Wyłączone"}
      </Button>
    </div>
  );
}

/**
 * Ustawienia kontrolera: czułość kamery (poziomo i pionowo), deadzone obu analogów, odwrócenie osi Y, wibracje.
 * Przyciski +/- zamiast suwaków, więc działają natywnym fokusem (pad, klawiatura, mysz). Zapis lokalny, poza zapisem gry.
 */
export function ControllerSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useControllerSettings();
  const pad = useGamepadInfo();
  const set = (patch: Partial<ControllerSettings>) => controllerSettings.set(patch);
  const sens = SETTING_LIMITS.sensitivity;
  const dz = SETTING_LIMITS.deadzone;
  const num = (key: NumericKey, id: string, label: string, lim: { min: number; max: number; step: number }, fmt: (v: number) => string) => (
    <Stepper id={id} label={label} value={s[key]} min={lim.min} max={lim.max} step={lim.step} format={fmt} onChange={(v) => set({ [key]: v } as Partial<ControllerSettings>)} />
  );
  const status =
    pad.status === "ready"
      ? `Podłączony kontroler: ${pad.name || "pad"}`
      : pad.status === "unsupported"
        ? "Wykryto kontroler z niestandardowym mapowaniem. Nie jest obsługiwany (użyj trybu standardowego)."
        : "Nie wykryto kontrolera. Naciśnij dowolny przycisk na padzie (przeglądarka udostępnia go dopiero wtedy).";
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent showCloseButton={false} className="max-w-md border-white/10 bg-slate-900 text-white" data-testid="controller-settings">
        <DialogHeader>
          <DialogTitle>Ustawienia kontrolera</DialogTitle>
          <DialogDescription data-testid="controller-status" className="text-slate-400">
            {status}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2.5">
          {num("cameraSensitivityX", "sens-x", "Czułość kamery (poziomo)", sens, (v) => `${v.toFixed(2)}×`)}
          {num("cameraSensitivityY", "sens-y", "Czułość kamery (pionowo)", sens, (v) => `${v.toFixed(2)}×`)}
          {num("leftDeadzone", "dz-left", "Martwa strefa lewego analoga", dz, (v) => v.toFixed(2))}
          {num("rightDeadzone", "dz-right", "Martwa strefa prawego analoga", dz, (v) => v.toFixed(2))}
          <Toggle id="invert-y" label="Odwróć oś pionową kamery" on={s.invertY} onChange={(v) => set({ invertY: v })} />
          <Toggle id="vibration" label="Wibracje" on={s.vibration} onChange={(v) => set({ vibration: v })} />
        </div>
        <div className="flex justify-between gap-2">
          <Button type="button" variant="secondary" data-testid="settings-reset" onClick={() => controllerSettings.reset()}>
            Domyślne
          </Button>
          <Button type="button" data-testid="settings-back" onClick={onClose}>
            Wróć (<HintText action="cancel" fallback="Esc" />)
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
