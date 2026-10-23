import { fingerprintOf } from "./fingerprint";
import { colliderRadius, type WorldObject } from "./objects";

/**
 * Profil kolizji skał (fizyka skał v1, od generatora świata v5). Dane należą do wersjonowanego świata: wynikają wyłącznie
 * z gatunku skały, jej skali, obrotu i przechyłu oraz z zamrożonej tabeli poniżej, NIE z aktualnie załadowanego modelu GLB.
 * Wymiary w tabeli zmierzono jednorazowo na modelach skał z katalogu zasobów gry (patrz `docs/projekt/fizyka-skal.md`);
 * wymiana grafiki nie zmienia kolizji, a zmiana tabeli lub stałych to nowa wersja generatora.
 */
export const ROCK_PHYSICS = Object.freeze({
  version: 1,
  /** Zagłębienie skały w terenie względem `WorldObject.y` (część skali Y, m); musi być równe `ROCK_SINK` renderera. */
  sink: 0.1,
  /** Zapas (m), o jaki stopy muszą przewyższać szczyt skały, by ta przestała blokować ruch poziomy. */
  clearance: 0.05,
  /** Tolerancja kontaktu z powierzchnią (m): stopy do tylu metrów pod nią nadal są "na" skale, a nie w jej bryle. */
  landingEpsilon: 0.03,
  /** O ile (m) środek kapsuły może wyjść poza dopasowany wierzch: stopa ma szerokość, więc przy krawędzi nadal stoi na skale. */
  supportOverhang: 0.1,
  /** Najmniejszy promień obszaru podparcia (m): węższy wierzch nie jest podłożem, skała zostaje samą przeszkodą. */
  minSupportRadius: 0.15,
  /** Największe nachylenie wierzchu (stopnie), na którym postać stoi stabilnie. */
  maxStandSlopeDeg: 30,
  /** Prędkość zsuwania się (m/s) z krawędzi, gdy postać po zejściu z wierzchu opada wzdłuż boku skały. */
  edgeSlideSpeed: 3.5,
  /** Największe wzniesienie powierzchni skały ponad stopami (m), które postać stojąca na skale "dogania" bez skoku. */
  stepUp: 0.12,
});

/**
 * Kształt modelu przy skali 1 (w osiach modelu, przed `sink`): `peak` to najwyższy punkt bryły (blokada ruchu poziomego
 * kończy się dopiero nad nim), a `plane` to największy "dysk stania" dopasowany do górnej powierzchni siatki
 * (płaszczyzna najmniejszych kwadratów przez środek dysku `cx, cz` na wysokości `y`, z nachyleniem `gx, gz` i promieniem `r`).
 */
export type RockShape = {
  peak: readonly [number, number, number];
  plane: { cx: number; cz: number; y: number; gx: number; gz: number; r: number };
};

/**
 * Zamrożona tabela fizyki skał v1. Pomiar jednorazowy na siatkach modeli skał (górna powierzchnia rastrowana co 5 cm,
 * dopasowanie płaszczyzny najmniejszych kwadratów w kole o promieniu r: reszta nie większa niż 5 cm, pokrycie co najmniej
 * 97%, nachylenie do 30°, największy promień, przy zbliżonych promieniach najwyższy dysk). Warianty `.desert` mają tę samą
 * bryłę (identyczne ramki i liczby wierzchołków), więc dzielą wpis ze zwykłymi.
 */
export const ROCK_SHAPES_V1: Readonly<Record<string, RockShape>> = Object.freeze({
  "rock.medium.1": { peak: [-0.05, 1.989, 0.973], plane: { cx: -0.027, cz: 0.65, y: 1.947, gx: -0.038, gz: 0.088, r: 0.45 } },
  "rock.medium.2": { peak: [-0.046, 1.848, -0.913], plane: { cx: -0.814, cz: 0.141, y: 1.563, gx: 0.265, gz: -0.111, r: 0.6 } },
  "rock.medium.3": { peak: [-0.074, 2.001, 0.035], plane: { cx: 0.476, cz: 0.71, y: 1.937, gx: 0.035, gz: 0.02, r: 0.45 } },
  "rock.medium.4": { peak: [0.92, 1.966, 0.118], plane: { cx: 0.338, cz: -0.109, y: 1.916, gx: 0.046, gz: 0.078, r: 0.6 } },
  "rock.big.1": { peak: [0.228, 4.453, -0.783], plane: { cx: 0.416, cz: -0.7, y: 4.383, gx: -0.335, gz: 0.125, r: 0.25 } },
  "rock.big.2": { peak: [1.307, 3.28, 0.121], plane: { cx: 0.166, cz: -0.305, y: 3.02, gx: 0.098, gz: 0.138, r: 0.65 } },
});

export type RockProfile = {
  /** Wysokość płaszczyzny szczytu nad podstawą obiektu (`WorldObject.y`), w jej środku; z uwzględnieniem skali osi Y, przechyłu i zagłębienia. */
  height: number;
  /** Wysokość najwyższego punktu bryły nad podstawą obiektu (m): ruch poziomy jest blokowany do tej wysokości (z zapasem). */
  wall: number;
  /** Czy wierzch nadaje się do stania (dość duży i niezbyt stromy). Brak = skała jest wyłącznie przeszkodą o skończonej wysokości. */
  standable: boolean;
  /** Środek obszaru podparcia względem środka obiektu (m, świat). */
  topOffset: readonly [number, number];
  /** Promień obszaru podparcia dla środka kapsuły (m); 0, gdy skała nie nadaje się do stania. */
  topRadius: number;
  /** Nachylenie wierzchu: gradient wysokości [dh/dx, dh/dz] (m/m) w osiach świata. */
  slope: readonly [number, number];
};

const q3 = (v: number) => Math.round(v * 1000) / 1000;
const q4 = (v: number) => Math.round(v * 10000) / 10000;
const RAD = 180 / Math.PI;

/** Klucz tabeli kształtów dla obiektu (`rock` + wariant bez przyrostka `.desert`) albo null. */
export function rockShapeKey(o: Pick<WorldObject, "kind" | "variant">): string | null {
  if (o.kind !== "rock" || !o.variant) return null;
  const variant = o.variant.endsWith(".desert") ? o.variant.slice(0, -".desert".length) : o.variant;
  const key = `rock.${variant}`;
  return Object.prototype.hasOwnProperty.call(ROCK_SHAPES_V1, key) ? key : null;
}

type ProfileInput = Pick<WorldObject, "kind" | "variant" | "scale" | "scaleXYZ" | "yaw" | "tilt" | "collider">;

/**
 * Buduje profil kolizji skały z tabeli v1 i parametrów instancji (skala osi, obrót, przechył). Funkcja czysta i
 * deterministyczna: wynik jest zaokrąglony do 1 mm (nachylenie do 1e-4), więc klient i serwer widzą te same liczby.
 * Punkty modelu są przekształcane jak w rendererze (skala, obroty w kolejności Three.js "YXZ": Ry * Rx * Rz, zagłębienie
 * `sink`). Zwraca null dla obiektów bez kształtu w tabeli (traktowane jak pełna przeszkoda).
 */
export function buildRockProfile(o: ProfileInput): RockProfile | null {
  const key = rockShapeKey(o);
  if (!key || !o.collider) return null;
  const shape = ROCK_SHAPES_V1[key];
  const uniform = o.scale ?? 1;
  const [sx, sy, sz] = o.scaleXYZ ?? [uniform, uniform, uniform];
  const yaw = o.yaw ?? 0;
  const [tx, tz] = o.tilt ?? [0, 0];
  const sinA = Math.sin(tx);
  const cosA = Math.cos(tx);
  const sinB = Math.sin(tz);
  const cosB = Math.cos(tz);
  const sinY = Math.sin(yaw);
  const cosY = Math.cos(yaw);
  const sink = ROCK_PHYSICS.sink * sy;
  /** Wektor w osiach modelu (po skali) -> osie świata względem środka obiektu. */
  const rotate = (x: number, y: number, z: number): [number, number, number] => {
    const x1 = x * cosB - y * sinB;
    const y1 = x * sinB + y * cosB;
    const y2 = y1 * cosA - z * sinA;
    const z2 = y1 * sinA + z * cosA;
    return [x1 * cosY + z2 * sinY, y2, -x1 * sinY + z2 * cosY];
  };

  // Najwyższy punkt bryły: nad nim skała nie blokuje ruchu poziomego.
  const wall = q3(rotate(shape.peak[0] * sx, shape.peak[1] * sy, shape.peak[2] * sz)[1] - sink);

  // Środek dysku stania i normalna jego płaszczyzny (model: y = y0 + gx*dx + gz*dz, po skali osi: nachylenie * sy / sx|sz).
  const p = shape.plane;
  const [x3, y3, z3] = rotate(p.cx * sx, p.y * sy, p.cz * sz);
  const height = q3(y3 - sink);
  const [nx, ny, nz] = rotate(-(p.gx * sy) / sx, 1, -(p.gz * sy) / sz);
  const gx = -nx / ny;
  const gz = -nz / ny;
  const slopeDeg = Math.atan(Math.hypot(gx, gz)) * RAD;

  const capR = p.r * Math.min(sx, sz) + ROCK_PHYSICS.supportOverhang;
  const insideCollider = colliderRadius(o.collider) - Math.hypot(x3, z3) - 0.05;
  const topRadius = Math.min(capR, insideCollider);
  const standable = topRadius >= ROCK_PHYSICS.minSupportRadius && slopeDeg <= ROCK_PHYSICS.maxStandSlopeDeg;
  // Skała niestojąca ma stałą wysokość równą najwyższemu punktowi bryły (nie da się na niej stać, więc bezpieczniej jest wyżej).
  if (!standable) return { height: wall, wall, standable: false, topOffset: [0, 0], topRadius: 0, slope: [0, 0] };
  return { height, wall, standable: true, topOffset: [q3(x3), q3(z3)], topRadius: q3(topRadius), slope: [q4(gx), q4(gz)] };
}

/** Górna granica bryły skały (m, bezwzględna): powyżej niej (z zapasem) skała przestaje blokować ruch poziomy. */
export function rockWallTop(o: WorldObject): number {
  const p = o.rock;
  if (!p) return Infinity;
  return o.y + Math.max(p.wall, p.height);
}

/** Wysokość płaszczyzny wierzchu skały (m, bezwzględna) nad punktem (x, z); dla skał niestojących: stały szczyt. */
export function rockSurfaceY(o: WorldObject, x: number, z: number): number {
  const p = o.rock;
  if (!p) return Infinity;
  if (!p.standable) return o.y + p.height;
  return o.y + p.height + p.slope[0] * (x - o.x - p.topOffset[0]) + p.slope[1] * (z - o.z - p.topOffset[1]);
}

/** Jak `rockSurfaceY`, ale punkt poza obszarem podparcia jest rzutowany na jego brzeg (bez ekstrapolacji nachylenia). */
export function rockSurfaceYClamped(o: WorldObject, x: number, z: number): number {
  const p = o.rock;
  if (!p) return Infinity;
  if (!p.standable) return o.y + p.height;
  const dx = x - o.x - p.topOffset[0];
  const dz = z - o.z - p.topOffset[1];
  const d = Math.hypot(dx, dz);
  const k = d > p.topRadius && d > 1e-9 ? p.topRadius / d : 1;
  return o.y + p.height + p.slope[0] * dx * k + p.slope[1] * dz * k;
}

/** Czy środek kapsuły w (x, z) leży nad obszarem podparcia wierzchu skały (reguła podparcia: środek w kole `topRadius`). */
export function rockSupports(o: WorldObject, x: number, z: number): boolean {
  const p = o.rock;
  if (!p || !p.standable) return false;
  return (x - o.x - p.topOffset[0]) ** 2 + (z - o.z - p.topOffset[1]) ** 2 <= p.topRadius * p.topRadius;
}

/** Odcisk całej definicji fizyki skał: wchodzi do odcisku świata v5, więc klient i serwer o różnej fizyce się nie połączą. */
export function rockPhysicsDigest(): string {
  return fingerprintOf({ physics: ROCK_PHYSICS, shapes: ROCK_SHAPES_V1 });
}
