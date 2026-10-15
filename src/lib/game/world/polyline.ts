export type PolyVertex = { x: number; z: number; w?: number };

export type SegmentHit = {
  /** Odległość do osi minus półszerokość w najbliższym punkcie (ujemna wewnątrz pasa). */
  gap: number;
  /** Odległość do osi. */
  d: number;
  /** Półszerokość w najbliższym punkcie osi. */
  w: number;
  /** Numer łamanej (kolejność dodawania). */
  poly: number;
  /** Numer segmentu w łamanej i położenie na nim (0..1). */
  seg: number;
  t: number;
  /** Długość łuku od początku łamanej. */
  s: number;
};

const OFFSET = 1 << 15;
const keyOf = (ix: number, iz: number) => (ix + OFFSET) * 65536 + (iz + OFFSET);

/**
 * Siatkowy indeks segmentów łamanych o zmiennej szerokości (rzeka, ścieżki). Zapytanie `nearest` zwraca
 * segment o najmniejszym `gap` w obrębie `reach` albo null. Koszt zależy od liczby segmentów w pobliżu.
 * Czysta arytmetyka (bez funkcji trygonometrycznych), więc wynik jest identyczny na każdej platformie.
 */
export class SegmentIndex {
  private readonly ax: number[] = [];
  private readonly az: number[] = [];
  private readonly bx: number[] = [];
  private readonly bz: number[] = [];
  private readonly w0: number[] = [];
  private readonly w1: number[] = [];
  private readonly arc: number[] = [];
  private readonly len: number[] = [];
  private readonly poly: number[] = [];
  private readonly local: number[] = [];
  private readonly cells = new Map<number, number[]>();
  private polyCount = 0;

  constructor(
    readonly reach: number,
    readonly cell = 16,
  ) {}

  get polylines(): number {
    return this.polyCount;
  }

  get segments(): number {
    return this.ax.length;
  }

  addPolyline(points: readonly PolyVertex[]): number {
    const id = this.polyCount++;
    let arc = 0;
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i];
      const b = points[i + 1];
      const idx = this.ax.length;
      const len = Math.sqrt((b.x - a.x) ** 2 + (b.z - a.z) ** 2);
      this.ax.push(a.x);
      this.az.push(a.z);
      this.bx.push(b.x);
      this.bz.push(b.z);
      this.w0.push(a.w ?? 0);
      this.w1.push(b.w ?? 0);
      this.arc.push(arc);
      this.len.push(len);
      this.poly.push(id);
      this.local.push(i);
      arc += len;
      const pad = Math.max(a.w ?? 0, b.w ?? 0) + this.reach;
      const x0 = Math.floor((Math.min(a.x, b.x) - pad) / this.cell);
      const x1 = Math.floor((Math.max(a.x, b.x) + pad) / this.cell);
      const z0 = Math.floor((Math.min(a.z, b.z) - pad) / this.cell);
      const z1 = Math.floor((Math.max(a.z, b.z) + pad) / this.cell);
      for (let iz = z0; iz <= z1; iz++) {
        for (let ix = x0; ix <= x1; ix++) {
          const key = keyOf(ix, iz);
          const list = this.cells.get(key);
          if (list) list.push(idx);
          else this.cells.set(key, [idx]);
        }
      }
    }
    return id;
  }

  nearest(x: number, z: number): SegmentHit | null {
    const list = this.cells.get(keyOf(Math.floor(x / this.cell), Math.floor(z / this.cell)));
    if (!list) return null;
    let bestGap = Infinity;
    let best = -1;
    let bestT = 0;
    let bestD = 0;
    for (let k = 0; k < list.length; k++) {
      const i = list[k];
      const dx = this.bx[i] - this.ax[i];
      const dz = this.bz[i] - this.az[i];
      const len2 = dx * dx + dz * dz;
      let t = len2 === 0 ? 0 : ((x - this.ax[i]) * dx + (z - this.az[i]) * dz) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const cx = this.ax[i] + t * dx - x;
      const cz = this.az[i] + t * dz - z;
      const d = Math.sqrt(cx * cx + cz * cz);
      const gap = d - (this.w0[i] + (this.w1[i] - this.w0[i]) * t);
      if (gap < bestGap) {
        bestGap = gap;
        best = i;
        bestT = t;
        bestD = d;
      }
    }
    if (best < 0 || bestGap > this.reach) return null;
    return {
      gap: bestGap,
      d: bestD,
      w: this.w0[best] + (this.w1[best] - this.w0[best]) * bestT,
      poly: this.poly[best],
      seg: this.local[best],
      t: bestT,
      s: this.arc[best] + bestT * this.len[best],
    };
  }
}
