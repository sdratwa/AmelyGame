import type { LandingInfo, SupportInfo } from "./playerController";
import type { TppSnapshot } from "./thirdPersonRig";

/** Czytelne nazwy rodzajów podparcia w panelu diagnostycznym. */
export const SURFACE_LABEL: Record<SupportInfo["kind"], string> = {
  terrain: "teren",
  bridge: "most",
  rock: "skała",
};

export type MovementDiagRow = { label: string; value: string };

const m2 = (v: number) => v.toFixed(2);

function surfaceText(s: SupportInfo | null): string {
  if (!s) return "-";
  return `${SURFACE_LABEL[s.kind]}${s.kind === "rock" ? ` ${s.id}` : ""}, Y ${m2(s.y)}`;
}

function landingText(l: LandingInfo | null): string {
  return l ? `${surfaceText(l)}, uderzenie ${m2(l.impact)} m/s` : "-";
}

/**
 * Wiersze diagnostyki pionu i podparcia: wysokość stóp, prędkość pionowa, stan (na ziemi/w powietrzu), powierzchnia
 * podparcia (teren/most/skała, jej wysokość i identyfikator skały), ostatnia blokada, ostatnie lądowanie oraz
 * potencjalne lądowanie (powierzchnia pod stopami, na którą postać opadłaby teraz).
 */
export function movementDiagRows(t: Pick<TppSnapshot, "y" | "vy" | "grounded" | "support" | "rockId" | "lastBlock" | "lastLanding" | "landingCandidate">): MovementDiagRow[] {
  return [
    { label: "Stopy Y", value: m2(t.y) },
    { label: "Vy", value: `${m2(t.vy)} m/s` },
    { label: "Stan", value: t.grounded ? "na ziemi" : "w powietrzu" },
    { label: "Podparcie", value: surfaceText(t.support) },
    { label: "Skała", value: t.rockId ?? "-" },
    { label: "Ost. blokada", value: t.lastBlock ?? "-" },
    { label: "Ost. lądowanie", value: landingText(t.lastLanding) },
    { label: "Potenc. lądowanie", value: t.grounded ? "-" : surfaceText(t.landingCandidate) },
  ];
}
