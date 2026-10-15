import type { Bounds } from "./bounds";

export type Indexed = { readonly id: string; readonly x: number; readonly z: number; readonly radius: number };

type Entry<T extends Indexed> = { item: T; x: number; z: number; r: number; cells: number[]; stamp: number };

const OFFSET = 1 << 15;
const keyOf = (ix: number, iz: number) => (ix + OFFSET) * 65536 + (iz + OFFSET);

export type QueryOptions<T> = { filter?: (item: T) => boolean };

/**
 * Indeks sektorowy (jednorodna siatka komórek). Obiekt o promieniu > 0 trafia do wszystkich
 * komórek, które przecina, więc wyszukiwanie widzi go z każdej strony granicy. Zapytania nie
 * zwracają duplikatów, a wyniki są uporządkowane deterministycznie.
 * Współrzędne nie są ograniczone regionem; `cellSize` domyślnie równy rozmiarowi sektora.
 */
export class SpatialIndex<T extends Indexed> {
  private readonly cells = new Map<number, Entry<T>[]>();
  private readonly entries = new Map<string, Entry<T>>();
  private stampCounter = 0;
  /** Liczba obiektów zbadanych w ostatnim zapytaniu (diagnostyka wydajności). */
  lastExamined = 0;

  constructor(readonly cellSize = 30) {
    if (!(cellSize > 0)) throw new Error("cellSize musi być dodatni");
  }

  get size(): number {
    return this.entries.size;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  get(id: string): T | undefined {
    return this.entries.get(id)?.item;
  }

  all(): T[] {
    return [...this.entries.values()].map((e) => e.item).sort(byId);
  }

  private cellRange(minX: number, minZ: number, maxX: number, maxZ: number) {
    const s = this.cellSize;
    return {
      x0: Math.floor(minX / s),
      x1: Math.floor(maxX / s),
      z0: Math.floor(minZ / s),
      z1: Math.floor(maxZ / s),
    };
  }

  add(item: T): void {
    if (this.entries.has(item.id)) throw new Error(`Obiekt ${item.id} już istnieje w indeksie`);
    if (![item.x, item.z, item.radius].every(Number.isFinite) || item.radius < 0) {
      throw new Error(`Niepoprawna geometria obiektu ${item.id}`);
    }
    const { x0, x1, z0, z1 } = this.cellRange(item.x - item.radius, item.z - item.radius, item.x + item.radius, item.z + item.radius);
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > 4096) throw new Error(`Obiekt ${item.id} jest zbyt duży dla indeksu`);
    const entry: Entry<T> = { item, x: item.x, z: item.z, r: item.radius, cells: [], stamp: 0 };
    for (let iz = z0; iz <= z1; iz++) {
      for (let ix = x0; ix <= x1; ix++) {
        const key = keyOf(ix, iz);
        entry.cells.push(key);
        const list = this.cells.get(key);
        if (list) list.push(entry);
        else this.cells.set(key, [entry]);
      }
    }
    this.entries.set(item.id, entry);
  }

  remove(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    for (const key of entry.cells) {
      const list = this.cells.get(key);
      if (!list) continue;
      const at = list.indexOf(entry);
      if (at >= 0) {
        list[at] = list[list.length - 1];
        list.pop();
      }
      if (list.length === 0) this.cells.delete(key);
    }
    this.entries.delete(id);
    return true;
  }

  /** Przeniesienie = usunięcie i ponowne dodanie obiektu o tym samym ID. */
  move(item: T): void {
    if (!this.remove(item.id)) throw new Error(`Obiekt ${item.id} nie istnieje w indeksie`);
    this.add(item);
  }

  /** Identyfikatory komórek (sektorów indeksu), w których leży obiekt – do testów i diagnostyki. */
  cellsOf(id: string): { ix: number; iz: number }[] {
    const entry = this.entries.get(id);
    if (!entry) return [];
    return entry.cells.map((key) => ({ ix: Math.floor(key / 65536) - OFFSET, iz: (key % 65536) - OFFSET }));
  }

  private collect(
    minX: number,
    minZ: number,
    maxX: number,
    maxZ: number,
    hit: (e: Entry<T>) => boolean,
    options?: QueryOptions<T>,
  ): Entry<T>[] {
    if (![minX, minZ, maxX, maxZ].every(Number.isFinite)) throw new Error("Zapytanie wymaga skończonych współrzędnych");
    const { x0, x1, z0, z1 } = this.cellRange(minX, minZ, maxX, maxZ);
    const stamp = ++this.stampCounter;
    const out: Entry<T>[] = [];
    let examined = 0;
    const span = (x1 - x0 + 1) * (z1 - z0 + 1);
    if (span > this.cells.size) {
      for (const list of this.cells.values()) this.scan(list, stamp, hit, options, out, () => examined++);
    } else {
      for (let iz = z0; iz <= z1; iz++) {
        for (let ix = x0; ix <= x1; ix++) {
          const list = this.cells.get(keyOf(ix, iz));
          if (list) this.scan(list, stamp, hit, options, out, () => examined++);
        }
      }
    }
    this.lastExamined = examined;
    return out;
  }

  private scan(
    list: Entry<T>[],
    stamp: number,
    hit: (e: Entry<T>) => boolean,
    options: QueryOptions<T> | undefined,
    out: Entry<T>[],
    count: () => void,
  ): void {
    for (const e of list) {
      if (e.stamp === stamp) continue;
      e.stamp = stamp;
      count();
      if (hit(e) && (!options?.filter || options.filter(e.item))) out.push(e);
    }
  }

  /** Obiekty, których okrąg ma wspólny punkt z kołem (x, z, r). Kolejność: odległość, potem ID. */
  queryRadius(x: number, z: number, r: number, options?: QueryOptions<T>): T[] {
    const found = this.collect(
      x - r,
      z - r,
      x + r,
      z + r,
      (e) => (e.x - x) ** 2 + (e.z - z) ** 2 <= (e.r + r) ** 2,
      options,
    );
    return found
      .map((e) => ({ e, d: (e.x - x) ** 2 + (e.z - z) ** 2 }))
      .sort((a, b) => a.d - b.d || (a.e.item.id < b.e.item.id ? -1 : a.e.item.id > b.e.item.id ? 1 : 0))
      .map(({ e }) => e.item);
  }

  /** Obiekty, których okrąg przecina prostokąt. Kolejność: ID. */
  queryArea(area: Bounds, options?: QueryOptions<T>): T[] {
    const found = this.collect(
      area.minX,
      area.minZ,
      area.maxX,
      area.maxZ,
      (e) => {
        const cx = Math.max(area.minX, Math.min(area.maxX, e.x));
        const cz = Math.max(area.minZ, Math.min(area.maxZ, e.z));
        return (e.x - cx) ** 2 + (e.z - cz) ** 2 <= e.r * e.r;
      },
      options,
    );
    return found.map((e) => e.item).sort(byId);
  }

  stats(): { objects: number; cells: number; maxPerCell: number; avgPerCell: number } {
    let max = 0;
    let total = 0;
    for (const list of this.cells.values()) {
      max = Math.max(max, list.length);
      total += list.length;
    }
    return {
      objects: this.entries.size,
      cells: this.cells.size,
      maxPerCell: max,
      avgPerCell: this.cells.size ? total / this.cells.size : 0,
    };
  }
}

const byId = (a: Indexed, b: Indexed) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
