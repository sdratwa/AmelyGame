/** Ręczne dopasowanie elementu do czaszki: pozycja (jednostki modelu, wysokość postaci = 1), obrót w stopniach i skala. */
export type PartFit = {
  position: [number, number, number];
  rotationDeg: [number, number, number];
  scale: [number, number, number];
};

export const IDENTITY_FIT: Readonly<PartFit> = { position: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] };

export const cloneFit = (f: PartFit): PartFit => ({ position: [...f.position], rotationDeg: [...f.rotationDeg], scale: [...f.scale] });

const triple = (v: unknown, fallback: [number, number, number], min: number, max: number): [number, number, number] => {
  if (!Array.isArray(v) || v.length !== 3) return [...fallback];
  return v.map((x, i) => (typeof x === "number" && Number.isFinite(x) ? Math.max(min, Math.min(max, x)) : fallback[i])) as [number, number, number];
};

/** Bezpieczne dopasowanie z dowolnych danych (np. wklejonego JSON): wartości przycinane do rozsądnych zakresów. */
export function sanitizeFit(raw: unknown, fallback: PartFit = IDENTITY_FIT): PartFit {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof PartFit, unknown>>;
  return {
    position: triple(r.position, fallback.position, -0.3, 0.3),
    rotationDeg: triple(r.rotationDeg, fallback.rotationDeg, -180, 180),
    scale: triple(r.scale, fallback.scale, 0.2, 3),
  };
}

export const fitToJson = (f: PartFit): string => JSON.stringify(f, null, 2);
