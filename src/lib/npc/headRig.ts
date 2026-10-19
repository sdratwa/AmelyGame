import * as THREE from "three";

/** Kąty w radianach: `yaw` dodatni = w lewo zwierzęcia (+Z modelu), `pitch` dodatni = głowa w górę. */
export type LookAngles = { yaw: number; pitch: number };

export type HeadLookConfig = {
  /** Zakres kąta spojrzenia na bok podczas postoju (rad). */
  yawRange: readonly [number, number];
  /** Zakres kąta spojrzenia na bok podczas marszu (rad); mniejszy, bo głowa kołysze się też w animacji. */
  walkYawRange: readonly [number, number];
  /** Maksymalne odchylenie pionowe spojrzenia (rad). */
  pitchRange: number;
  /** Przerwa w patrzeniu na wprost między kolejnymi rozejrzeniami (s) i czas utrzymania spojrzenia (s). */
  gap: readonly [number, number];
  hold: readonly [number, number];
  /** Pulsacja sprężyny wygładzającej (rad/s): im większa, tym szybciej głowa dochodzi do celu. */
  stiffness: number;
  /** Maksymalna prędkość obrotu głowy (rad/s). */
  maxRate: number;
  /** Największe odchylenie od przodu przy patrzeniu na gracza (rad). */
  watchYawLimit: number;
  watchPitchLimit: number;
};

export const DEFAULT_HEAD_LOOK: HeadLookConfig = {
  yawRange: [0.45, 0.8],
  walkYawRange: [0.25, 0.45],
  pitchRange: 0.14,
  gap: [1.6, 4.2],
  hold: [0.9, 1.9],
  stiffness: 5.5,
  maxRate: 1.6,
  watchYawLimit: 1.15,
  watchPitchLimit: 0.2,
};

export type LookIntent =
  | { kind: "free"; walking: boolean }
  /** Patrzy na cel: kąty względem przodu ciała (rad); poza zakresem są przycinane, a po utracie celu głowa wraca płynnie do neutralnej. */
  | { kind: "watch"; yaw: number; pitch: number };

const wrap = (a: number) => {
  const r = a % (Math.PI * 2);
  return r > Math.PI ? r - Math.PI * 2 : r < -Math.PI ? r + Math.PI * 2 : r;
};

/**
 * Proceduralne spojrzenia głowy (czysta logika): w spokoju na przemian patrzy na wprost (poza neutralną) i rozgląda się
 * w lewo i prawo (kolejne spojrzenia zwykle na przeciwne strony), a przy `watch` patrzy na cel. Kąty wygładza sprężyna
 * krytycznie tłumiona z ograniczeniem prędkości, więc nie ma szarpnięć, a powrót do neutralnej pozycji jest płynny.
 */
export class HeadLook {
  yaw = 0;
  pitch = 0;
  private yawVelocity = 0;
  private pitchVelocity = 0;
  private targetYaw = 0;
  private targetPitch = 0;
  private timer: number;
  private glancing = false;
  private lastSide = 1;
  private watching = false;

  constructor(
    private readonly rng: () => number,
    private readonly config: HeadLookConfig = DEFAULT_HEAD_LOOK,
  ) {
    this.timer = this.between(config.gap);
  }

  private between([lo, hi]: readonly [number, number]): number {
    return lo + this.rng() * (hi - lo);
  }

  /** Czy głowa jest w stanie spojrzenia na bok (nie w pozycji neutralnej). */
  get isGlancing(): boolean {
    return this.glancing;
  }

  get isWatching(): boolean {
    return this.watching;
  }

  update(dt: number, intent: LookIntent): void {
    const step = Math.min(Math.max(dt, 0), 0.1);
    if (step === 0) return;
    if (intent.kind === "watch") {
      this.watching = true;
      this.glancing = false;
      const c = this.config;
      this.targetYaw = Math.max(-c.watchYawLimit, Math.min(c.watchYawLimit, wrap(intent.yaw)));
      this.targetPitch = Math.max(-c.watchPitchLimit, Math.min(c.watchPitchLimit, intent.pitch));
    } else {
      if (this.watching) {
        this.watching = false;
        this.glancing = false;
        this.targetYaw = 0;
        this.targetPitch = 0;
        this.timer = this.between(this.config.gap);
      }
      this.timer -= step;
      if (this.timer <= 0) {
        if (this.glancing) {
          this.glancing = false;
          this.targetYaw = 0;
          this.targetPitch = 0;
          this.timer = this.between(this.config.gap);
        } else {
          this.glancing = true;
          // Zwykle na przeciwną stronę niż poprzednio, żeby rozglądanie wyglądało naturalnie (lewo, prawo, lewo...).
          const side = this.rng() < 0.7 ? -this.lastSide : this.lastSide;
          this.lastSide = side;
          const range = intent.walking ? this.config.walkYawRange : this.config.yawRange;
          this.targetYaw = side * this.between(range);
          this.targetPitch = (this.rng() * 2 - 1) * this.config.pitchRange;
          this.timer = this.between(this.config.hold);
        }
      }
    }
    this.yaw = this.spring(this.yaw, this.targetYaw, "yawVelocity", step);
    this.pitch = this.spring(this.pitch, this.targetPitch, "pitchVelocity", step);
  }

  private spring(value: number, target: number, key: "yawVelocity" | "pitchVelocity", dt: number): number {
    const w = this.config.stiffness;
    let v = this[key];
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    let x = value;
    for (let i = 0; i < n; i++) {
      v += (w * w * (target - x) - 2 * w * v) * h;
      v = Math.max(-this.config.maxRate, Math.min(this.config.maxRate, v));
      x += v * h;
    }
    this[key] = v;
    return x;
  }
}

/** Obrót w układzie modelu jelenia (przód -X, góra +Y, lewa strona +Z): `yaw` wokół góry, `pitch` w górę wokół osi bocznej Z. */
export function lookRotation(yaw: number, pitchUp: number, out = new THREE.Quaternion()): THREE.Quaternion {
  const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const qz = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -pitchUp);
  return out.copy(qy).multiply(qz);
}

/**
 * Nakładka na kość: obrót zadany w układzie świata modelu (mnożony z lewej, jak obrót całej kości w świecie) zamieniamy
 * na obrót lokalny względem pozy spoczynkowej kości. Mikser zapisuje kość tylko wtedy, gdy wartość z klipu się zmieniła
 * (poza zamrożona jest stała), więc nie wolno mnożyć kumulatywnie: pamiętamy bazę z miksera i ostatnio zapisany wynik, a
 * bazę odświeżamy tylko wtedy, gdy mixer kość faktycznie nadpisał (to samo rozwiązanie co w warstwie proceduralnej animatora).
 */
export class BoneOffset {
  private readonly base = new THREE.Quaternion();
  private written: THREE.Quaternion | null = null;
  private readonly restWorld = new THREE.Quaternion();
  private readonly restWorldInverse = new THREE.Quaternion();
  private readonly local = new THREE.Quaternion();

  constructor(readonly bone: THREE.Object3D) {
    bone.updateWorldMatrix(true, false);
    bone.getWorldQuaternion(this.restWorld);
    this.restWorldInverse.copy(this.restWorld).invert();
  }

  /** Nakłada obrót świata `rotation` na kość (po aktualizacji miksera). */
  apply(rotation: THREE.Quaternion): void {
    const bone = this.bone;
    if (!this.written || !bone.quaternion.equals(this.written)) this.base.copy(bone.quaternion);
    this.local.copy(this.restWorldInverse).multiply(rotation).multiply(this.restWorld);
    bone.quaternion.copy(this.base).multiply(this.local);
    this.written = (this.written ?? new THREE.Quaternion()).copy(bone.quaternion);
  }

  /** Przywraca pozę z miksera (np. po wyłączeniu nakładki). */
  release(): void {
    if (this.written && this.bone.quaternion.equals(this.written)) this.bone.quaternion.copy(this.base);
    this.written = null;
  }
}

export type HeadRigOptions = {
  head: THREE.Object3D;
  neck?: THREE.Object3D | null;
  /** Neutralna korekta głowy (stopnie, układ modelu): obrót wokół góry i uniesienie pyska. */
  correction: { yawDeg: number; pitchDeg: number };
  /** Jaka część spojrzenia przypada na kość szyi (reszta na głowę). */
  neckShare?: number;
};

const DEG = Math.PI / 180;

/**
 * Głowa jelenia: stała korekta ustawienia głowy (w pliku jest obrócona o ok. 90° względem ciała) i spojrzenia z `HeadLook`
 * rozłożone na szyję i głowę. Działa po aktualizacji animacji, na każdej pozie (marsz i postój).
 */
export class HeadRig {
  private readonly head: BoneOffset;
  private readonly neck: BoneOffset | null;
  private readonly neckShare: number;
  private readonly correction = new THREE.Quaternion();
  private readonly qa = new THREE.Quaternion();
  private readonly qb = new THREE.Quaternion();

  constructor(options: HeadRigOptions) {
    this.head = new BoneOffset(options.head);
    this.neck = options.neck ? new BoneOffset(options.neck) : null;
    this.neckShare = options.neck ? (options.neckShare ?? 0.35) : 0;
    const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), options.correction.yawDeg * DEG);
    const pitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), options.correction.pitchDeg * DEG);
    this.correction.copy(pitch).multiply(yaw);
  }

  /** Obrót kości głowy względem pozy z animacji bez spojrzenia (korekta neutralna). */
  get neutral(): THREE.Quaternion {
    return this.correction;
  }

  apply(look: LookAngles): void {
    const neckShare = this.neckShare;
    if (this.neck) this.neck.apply(lookRotation(look.yaw * neckShare, look.pitch * neckShare, this.qa));
    this.head.apply(lookRotation(look.yaw * (1 - neckShare), look.pitch * (1 - neckShare), this.qb).multiply(this.correction));
  }

  dispose(): void {
    this.head.release();
    this.neck?.release();
  }
}
