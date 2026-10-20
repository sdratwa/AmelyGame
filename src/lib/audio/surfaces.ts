/**
 * Profile nawierzchni kroków. Dostarczone nagrania to cztery warianty jednego kroku (lekki krok w lesie), a nie komplet
 * dźwięków różnych materiałów, więc wszystkie nawierzchnie dziś używają tej samej puli próbek z subtelnymi korektami
 * głośności i barwy. Gdy pojawią się osobne nagrania (kamień, drewno, trawa), wystarczy dodać pulę w `FOOTSTEP_POOLS`
 * i wskazać ją w polu `pool` profilu: reszta (losowanie, odtwarzanie, diagnostyka) się nie zmienia.
 */
export type SurfaceId = "litter" | "path" | "grass" | "rock" | "wood";

export const FOOTSTEP_POOLS: Readonly<Record<string, readonly string[]>> = {
  "forest.light": ["footsteps.light.1", "footsteps.light.2", "footsteps.light.3", "footsteps.light.4"],
};

export type SurfaceProfile = {
  id: SurfaceId;
  label: string;
  /** Pula próbek (klucz `FOOTSTEP_POOLS`). */
  pool: string;
  /** Mnożnik głośności i środek barwy (filtr dolnoprzepustowy, Hz): korekty, nie podmiana nagrania. */
  gain: number;
  lowpassHz: number;
  /** Czy świat potrafi dziś rozpoznać tę nawierzchnię (`false` = profil gotowy, ale bez wykrywania). */
  detected: boolean;
};

export const SURFACE_PROFILES: Readonly<Record<SurfaceId, SurfaceProfile>> = {
  litter: { id: "litter", label: "leśna ściółka", pool: "forest.light", gain: 1, lowpassHz: 11000, detected: true },
  path: { id: "path", label: "ziemna ścieżka", pool: "forest.light", gain: 0.92, lowpassHz: 12500, detected: true },
  grass: { id: "grass", label: "trawa", pool: "forest.light", gain: 0.86, lowpassHz: 9000, detected: true },
  rock: { id: "rock", label: "skały", pool: "forest.light", gain: 1.04, lowpassHz: 13500, detected: false },
  wood: { id: "wood", label: "drewniany most", pool: "forest.light", gain: 1.04, lowpassHz: 13500, detected: false },
};

export const DEFAULT_SURFACE: SurfaceId = "litter";

/** Wynik `ForestWorld.surfaceAt` (tylko pola, których potrzebujemy). */
export type WorldSurface = { surface: "water" | "path" | "ground"; profile: string };

/**
 * Nawierzchnia z danych świata, bez raycastów: ścieżka z geometrii ścieżek, trawa z profilu środowiska (polana i brzeg rzeki),
 * reszta to ściółka. Skały i most nie są jeszcze rozpoznawane (świat nie udostępnia ich pod stopami za darmo).
 */
export function surfaceFromWorld(w: WorldSurface): SurfaceId {
  if (w.surface === "path") return "path";
  if (w.surface === "ground" && (w.profile === "clearing" || w.profile === "riverside")) return "grass";
  return "litter";
}

export function poolSamples(surface: SurfaceId): readonly string[] {
  return FOOTSTEP_POOLS[SURFACE_PROFILES[surface].pool];
}
