import type { MovementGate } from "./types";

/** Tolerancja (m) położenia poziomego względem kotwicy; klient ustawia kotwicę dokładnie, margines chroni przed zaokrągleniami. */
export const GATE_TOLERANCE = 0.08;
/** Największa dozwolona prędkość pozioma przy kotwicy (m/s): skok w miejscu nie ma ruchu poziomego. */
export const GATE_MAX_SPEED = 0.35;

export type GateSample = { x: number; z: number; vx: number; vz: number; crouching: boolean; jumpSequence: number };
export type GateVerdict = { ok: true } | { ok: false; reason: "moved" | "velocity" | "jumped" | "crouched" };

/**
 * Czy próbka ruchu mieści się w bramce. To jedyne miejsce, które decyduje o blokadzie po stronie serwera (handler `motion`);
 * klient stosuje tę samą bramkę do wejścia, ale serwer nie ufa temu, że to zrobił. `prev` to ostatnia przyjęta próbka gracza.
 */
export function gateAcceptsMotion(gate: MovementGate, next: GateSample, prev: Pick<GateSample, "crouching" | "jumpSequence">): GateVerdict {
  if (gate.anchor) {
    if (Math.hypot(next.x - gate.anchor.x, next.z - gate.anchor.z) > GATE_TOLERANCE) return { ok: false, reason: "moved" };
    if (Math.hypot(next.vx, next.vz) > GATE_MAX_SPEED) return { ok: false, reason: "velocity" };
  }
  if (!gate.allowJump && next.jumpSequence > prev.jumpSequence) return { ok: false, reason: "jumped" };
  if (!gate.allowCrouch && next.crouching !== prev.crouching) return { ok: false, reason: "crouched" };
  return { ok: true };
}

export const sameGate = (a: MovementGate, b: MovementGate): boolean =>
  a.allowJump === b.allowJump &&
  a.allowCrouch === b.allowCrouch &&
  a.allowLook === b.allowLook &&
  a.cameraDown === b.cameraDown &&
  (a.anchor === b.anchor || (!!a.anchor && !!b.anchor && a.anchor.x === b.anchor.x && a.anchor.z === b.anchor.z));
