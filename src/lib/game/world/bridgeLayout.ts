/**
 * Układ mostu nad rzeką (dane geometryczne, bez Three.js): oś, długość, liczba segmentów modelu, profil pokładu
 * (wysokość, po której chodzi gracz) i punkty latarni. To WARSTWA DODATKOWA nad terenem: wysokość terenu nadal pochodzi
 * wyłącznie z `terrainHeight`, a profil pokładu jest używany tylko, gdy most jest zbudowany (kontroler gracza bierze
 * wyższą z wartości, więc oczy nigdy nie wchodzą w grunt). Nie zmienia generatora rzeki ani szerokości przejścia
 * (`passage.bridge`, półszerokość 2,2 m): przejście otwiera barierę rzeki, a ten układ tylko opisuje wygląd i wysokość.
 *
 * Model GLB (`public/props/bridge.glb`) to łuk o długości 1,685 jednostki modelu. Aby dopasować go do rzeki (19-23 m
 * między lądowiskami), końcówki i latarnie zostają oryginalne, a środek jest powielany z segmentów o okresie
 * `BRIDGE_PERIOD` (belki poprzeczne i słupki powtarzają się co ok. 0,21), spłaszczonych względem oryginalnego łuku.
 */
import type { Point2 } from "./anchors";
import { FOREST_PLAN } from "./generators/v2/plan";

/** Półszerokość użytecznego pokładu (m) = półszerokość przejścia `passage.bridge`. */
export const BRIDGE_HALF_WIDTH = FOREST_PLAN.bridge.passageHalfWidth;

/** Stałe geometrii modelu (jednostki modelu), wyliczone z analizy siatki `miasto_bridge_optimized.glb`. */
export const BRIDGE_MODEL = {
  /** Skala jednostajna model -> świat: wnętrze poręczy ok. 4,5 m przy ok. 0,39 jedn. modelu od osi. */
  scale: 5.8,
  /** Okres powtarzalnego segmentu środkowej części (belka poprzeczna + słupek). */
  period: 0.21,
  /** Granica między końcówką (przyczółek) a częścią środkową (|z| modelu). */
  endCut: 0.525,
  /** Koniec pokładu na końcówce (|z| modelu): tu pokład styka się z lądowiskiem. */
  deckTip: 0.725,
  /** Dalszy kraniec modelu (|z| modelu), z zapasem na wierzchołki leżące dokładnie na krawędzi. */
  halfLength: 0.8443,
  /** Wysokość pokładu w osi: parabola y = deckTop - deckArch * z^2 (pomiar powierzchni desek). */
  deckTop: 0.0145,
  deckArch: 0.237,
  /** Środek lampy względem wysokości pokładu w osi (jedn. modelu) i odległość od osi mostu. */
  lampHeight: 0.3355,
  lampAcross: 0.4,
  /** Środek lamp w modelu (jedn.): bryła lampy ma ok. 0,10 x 0,10 x 0,08. */
  lampSize: { x: 0.1, y: 0.1, z: 0.08 },
} as const;

/**
 * O ile (jedn. modelu) pokład końcówki wystaje poza granicę części środkowej (`endCut`): od granicy do czubka pokładu.
 * Całkowita długość pokładu w układzie złożonym to `bays * period + 2 * END_REACH` (NIE `bays * period + 2 * deckTip`:
 * `deckTip` jest liczony od środka modelu, a środkowa część w złożeniu jest już policzona przez `bays * period`).
 */
export const END_REACH = BRIDGE_MODEL.deckTip - BRIDGE_MODEL.endCut;

/** Wysokość pokładu w osi dla oryginalnego łuku (jedn. modelu) w odległości |z| od środka modelu. */
export const modelDeckArch = (z: number): number => BRIDGE_MODEL.deckTop - BRIDGE_MODEL.deckArch * z * z;

/** Poziom płaskiego pokładu środkowej części (jedn. modelu): równy łukowi na granicy końcówki, więc połączenie jest ciągłe. */
export const MODEL_FLAT_DECK = modelDeckArch(BRIDGE_MODEL.endCut);
/** Poziom pokładu na końcu końcówki (u lądowiska). */
export const MODEL_TIP_DECK = modelDeckArch(BRIDGE_MODEL.deckTip);

/** Dozwolone odchylenie skali wzdłuż osi (rozciągnięcie lub ściśnięcie), by dopasować długość do rzeki. */
export const MAX_AXIS_STRETCH = 0.04;
/** Zapas przejścia za końcami pokładu (jak w generatorze: pas przejścia wystaje 0,5 m za lądowiska). */
export const BRIDGE_OVERHANG = 0.5;
/** Poręcze (collidery) pomijają odcinki przy końcach (podjazdy), by wejście z boku na podjazd było swobodne. */
export const BRIDGE_RAIL_INSET = 1.4;
export const BRIDGE_RAIL_OFFSET = 2.4;
export const BRIDGE_RAIL_HALF_THICKNESS = 0.15;

/** Rodzaje źródłowych fragmentów modelu (zakresy |z| w jedn. modelu patrz `BRIDGE_SOURCE_RANGES`). */
export type BridgeSource = "end_west" | "bay_w2" | "bay_w1" | "lamp" | "bay_e1" | "bay_e2" | "end_east";

/** Zakresy z (jedn. modelu) źródłowych fragmentów: dzielą model w płaszczyznach między belkami poprzecznymi. */
export const BRIDGE_SOURCE_RANGES: Readonly<Record<BridgeSource, readonly [number, number]>> = {
  end_west: [-BRIDGE_MODEL.halfLength, -BRIDGE_MODEL.endCut],
  bay_w2: [-BRIDGE_MODEL.endCut, -BRIDGE_MODEL.endCut + BRIDGE_MODEL.period],
  bay_w1: [-BRIDGE_MODEL.endCut + BRIDGE_MODEL.period, -BRIDGE_MODEL.period / 2],
  lamp: [-BRIDGE_MODEL.period / 2, BRIDGE_MODEL.period / 2],
  bay_e1: [BRIDGE_MODEL.period / 2, BRIDGE_MODEL.endCut - BRIDGE_MODEL.period],
  bay_e2: [BRIDGE_MODEL.endCut - BRIDGE_MODEL.period, BRIDGE_MODEL.endCut],
  end_east: [BRIDGE_MODEL.endCut, BRIDGE_MODEL.halfLength],
};

/** Jeden element złożonego mostu: skąd z modelu, i gdzie (początek zakresu w układzie złożonym, jedn. modelu). */
export type BridgeSlot = { source: BridgeSource; dstStart: number; lamp: boolean };

export type BridgeLampPoint = {
  id: string;
  /** Pozycja świata (m). */
  x: number;
  y: number;
  z: number;
  /** Strona: -1 lewa, +1 prawa względem kierunku zachód -> wschód. */
  side: -1 | 1;
  /** Odległość wzdłuż pokładu od lądowiska zachodniego (m). */
  along: number;
};

export type BridgeLayout = {
  west: Point2;
  east: Point2;
  /** Wysokość terenu na końcach pokładu (lądowiska). */
  yWest: number;
  yEast: number;
  /** Jednostkowy wektor wzdłuż mostu (zachód -> wschód) i prostopadły (w lewo patrząc na wschód). */
  axis: Point2;
  normal: Point2;
  /** Obrót modelu wokół Y (rad): oś Z modelu pokrywa się z osią mostu. */
  yaw: number;
  /** Długość pokładu między lądowiskami (m). */
  length: number;
  /** Liczba powtarzalnych segmentów części środkowej. */
  bays: number;
  /** Skala jednostajna oraz mnożnik skali wzdłuż osi (blisko 1, `MAX_AXIS_STRETCH`). */
  scale: number;
  axisScale: number;
  /** Połowa długości części środkowej w układzie złożonym (jedn. modelu). */
  halfMid: number;
  slots: BridgeSlot[];
  lamps: BridgeLampPoint[];
  /** Wysokość pokładu w odległości `a` m od lądowiska zachodniego (a poza [0, długość] jest obcinane). */
  deckAt(a: number): number;
  /** Pokład pod punktem świata (wysokość) albo null, gdy punkt leży poza pokładem (z zapasem na końcach). */
  deckHeightAt(x: number, z: number): number | null;
  /** Odległość wzdłuż pokładu i poprzecznie (m) dla punktu świata. */
  project(x: number, z: number): { along: number; across: number };
};

/** Liczba segmentów środkowej części dla długości pokładu `length` (najmniejsze rozciągnięcie przy skali jednostajnej). */
export function bayCountFor(length: number, scale = BRIDGE_MODEL.scale): number {
  const raw = (length / scale - 2 * END_REACH) / BRIDGE_MODEL.period;
  return Math.max(3, Math.round(raw));
}

/** Odstęp między lampami (liczba segmentów). */
export const LAMP_SPACING = 3;

/**
 * Indeksy segmentów środkowej części z latarniami: symetrycznie względem środka, co `LAMP_SPACING` segmenty,
 * nigdy przy samej końcówce (skrajne segmenty są łącznikami z przyczółkami).
 */
export function lampIndices(bays: number): number[] {
  const mid = (bays - 1) / 2;
  const first = bays % 2 === 1 ? 0 : LAMP_SPACING / 2;
  const out = new Set<number>();
  for (let p = first; p < mid; p += LAMP_SPACING) {
    out.add(mid - p);
    out.add(mid + p);
  }
  if (out.size === 0) {
    out.add(Math.floor(mid));
    out.add(Math.ceil(mid));
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * Wylicza układ mostu dla danych lądowisk. `heightAt` to wysokość terenu (np. `terrain.height`); na końcach pokład
 * dokładnie stoi na terenie, a między nimi leży wzdłuż linii prostej między końcami z podjazdami i płaskim środkiem.
 */
export function planBridge(landings: { west: Point2; east: Point2 }, heightAt: (x: number, z: number) => number): BridgeLayout {
  const { west, east } = landings;
  const dx = east.x - west.x;
  const dz = east.z - west.z;
  const length = Math.hypot(dx, dz);
  if (!(length > 1)) throw new Error("Most: lądowiska zbyt blisko siebie");
  const axis = { x: dx / length, z: dz / length };
  const normal = { x: axis.z, z: -axis.x };
  const scale = BRIDGE_MODEL.scale;
  const bays = bayCountFor(length, scale);
  const nominal = scale * (bays * BRIDGE_MODEL.period + 2 * END_REACH);
  const axisScale = length / nominal;
  const halfMid = (bays * BRIDGE_MODEL.period) / 2;
  const yWest = heightAt(west.x, west.z);
  const yEast = heightAt(east.x, east.z);

  const lampSet = new Set(lampIndices(bays));
  const slots: BridgeSlot[] = [{ source: "end_west", dstStart: -halfMid - (BRIDGE_MODEL.halfLength - BRIDGE_MODEL.endCut), lamp: false }];
  for (let i = 0; i < bays; i++) {
    const start = -halfMid + i * BRIDGE_MODEL.period;
    let source: BridgeSource;
    if (i === 0) source = "bay_w2";
    else if (i === bays - 1) source = "bay_e2";
    else if (lampSet.has(i)) source = "lamp";
    else source = i < (bays - 1) / 2 ? "bay_w1" : "bay_e1";
    slots.push({ source, dstStart: start, lamp: source === "lamp" });
  }
  slots.push({ source: "end_east", dstStart: halfMid, lamp: false });

  // Koniec pokładu (czubek) w układzie złożonym leży o `deckTip - endCut` za granicą części środkowej.
  const tipZ = halfMid + END_REACH;
  const metersPerUnit = scale * axisScale;
  const toModelZ = (a: number) => -tipZ + a / metersPerUnit;
  const base = (a: number) => yWest + ((yEast - yWest) * Math.min(Math.max(a, 0), length)) / length;
  /** Poziom pokładu w osi w jedn. modelu dla współrzędnej złożonej zg (płaski środek, końcówki wg łuku). */
  const modelDeck = (zg: number) => {
    const az = Math.abs(zg);
    if (az <= halfMid) return MODEL_FLAT_DECK;
    return modelDeckArch(az - halfMid + BRIDGE_MODEL.endCut);
  };
  const deckAt = (a: number) => {
    const c = Math.min(Math.max(a, 0), length);
    return base(c) + (modelDeck(toModelZ(c)) - MODEL_TIP_DECK) * scale;
  };
  const project = (x: number, z: number) => {
    const rx = x - west.x;
    const rz = z - west.z;
    return { along: rx * axis.x + rz * axis.z, across: rx * normal.x + rz * normal.z };
  };
  const deckHeightAt = (x: number, z: number) => {
    const { along, across } = project(x, z);
    if (along < -BRIDGE_OVERHANG || along > length + BRIDGE_OVERHANG || Math.abs(across) > BRIDGE_HALF_WIDTH + 0.01) return null;
    return deckAt(along);
  };

  const lamps: BridgeLampPoint[] = [];
  slots.forEach((slot, index) => {
    if (!slot.lamp) return;
    const centerZ = slot.dstStart + BRIDGE_MODEL.period / 2;
    const along = (centerZ + tipZ) * metersPerUnit;
    const y = base(along) + (MODEL_FLAT_DECK - MODEL_TIP_DECK + BRIDGE_MODEL.lampHeight) * scale;
    for (const side of [-1, 1] as const) {
      const across = side * BRIDGE_MODEL.lampAcross * scale;
      lamps.push({
        id: `lamp.${index}.${side < 0 ? "l" : "r"}`,
        x: west.x + axis.x * along + normal.x * across,
        y,
        z: west.z + axis.z * along + normal.z * across,
        side,
        along,
      });
    }
  });

  return {
    west,
    east,
    yWest,
    yEast,
    axis,
    normal,
    yaw: Math.atan2(axis.x, axis.z),
    length,
    bays,
    scale,
    axisScale,
    halfMid,
    slots,
    lamps,
    deckAt,
    deckHeightAt,
    project,
  };
}

/** Prostokątne collidery poręczy (uproszczone, nie z geometrii GLB): wzdłuż obu krawędzi pokładu, bez podjazdów. */
export type BridgeRailBox = { id: string; x: number; z: number; halfX: number; halfZ: number; yaw: number };

export function bridgeRailBoxes(layout: BridgeLayout): BridgeRailBox[] {
  const start = BRIDGE_RAIL_INSET;
  const end = layout.length - BRIDGE_RAIL_INSET;
  if (end <= start) return [];
  const mid = (start + end) / 2;
  const out: BridgeRailBox[] = [];
  for (const side of [-1, 1] as const) {
    const across = side * BRIDGE_RAIL_OFFSET;
    out.push({
      id: `bridge.rail.${side < 0 ? "l" : "r"}`,
      x: layout.west.x + layout.axis.x * mid + layout.normal.x * across,
      z: layout.west.z + layout.axis.z * mid + layout.normal.z * across,
      halfX: BRIDGE_RAIL_HALF_THICKNESS,
      halfZ: (end - start) / 2,
      // Lokalna oś Z collidera (kierunek (sin yaw, cos yaw)) ma pokrywać się z osią mostu.
      yaw: Math.atan2(layout.axis.x, layout.axis.z),
    });
  }
  return out;
}
