/**
 * Wejście gracza TPP: mapuje klawiaturę i mysz na akcje (`PlayerIntent`). Logika ruchu zna tylko `PlayerIntent`, więc
 * pad i ekran dotykowy w przyszłości dostarczą te same pola (`setExternal`) bez zmian w kontrolerze.
 */
export type PlayerIntent = {
  /** Prawo (+1) / lewo (-1), -1..1. */
  moveX: number;
  /** Przód (+1) / tył (-1), -1..1. */
  moveY: number;
  run: boolean;
  /** Jedno przełączenie kucania od ostatniego odczytu (zdarzenie, nie stan). */
  crouchToggle: boolean;
  /** Jedna prośba o skok od ostatniego odczytu (zdarzenie, nie stan). */
  jump: boolean;
  /** Przesunięcie myszy w pikselach od ostatniego odczytu. */
  lookDx: number;
  lookDy: number;
};

export const TPP_KEYS = {
  forward: ["KeyW", "ArrowUp"],
  back: ["KeyS", "ArrowDown"],
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  run: ["ShiftLeft", "ShiftRight"],
  crouch: ["KeyC"],
  jump: ["Space"],
} as const;

const HANDLED = new Set<string>(Object.values(TPP_KEYS).flat());

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- cel to `window`/`document` (przeciążone addEventListener) i atrapy w testach
type Listener = (e: any) => void;
type Target = { addEventListener(type: string, fn: Listener): void; removeEventListener(type: string, fn: Listener): void };

export class PlayerInput {
  private readonly down = new Set<string>();
  private crouchEdge = false;
  private jumpEdge = false;
  private dx = 0;
  private dy = 0;
  private ext = { x: 0, y: 0, run: false };
  private detachers: (() => void)[] = [];

  /** Czy klawisz należy do sterowania (wywołujący może wtedy wstrzymać domyślną akcję przeglądarki, np. przewijanie spacją). */
  static handles(code: string): boolean {
    return HANDLED.has(code);
  }

  /** Zwraca true, gdy klawisz został obsłużony. Powtórzenia klawisza (auto-repeat) nie wywołują zdarzeń. */
  handleKey(code: string, down: boolean, repeat = false): boolean {
    if (!HANDLED.has(code)) return false;
    if (down) {
      if (!this.down.has(code) && !repeat) {
        if ((TPP_KEYS.crouch as readonly string[]).includes(code)) this.crouchEdge = true;
        if ((TPP_KEYS.jump as readonly string[]).includes(code)) this.jumpEdge = true;
      }
      this.down.add(code);
    } else {
      this.down.delete(code);
    }
    return true;
  }

  /** Skok z innego źródła niż klawiatura (pad, dotyk): jedno zdarzenie, tak jak Spacja. */
  requestJump(): void {
    this.jumpEdge = true;
  }

  /** Przełączenie kucania z innego źródła niż klawiatura (pad, dotyk): jedno zdarzenie, tak jak C. */
  requestCrouchToggle(): void {
    this.crouchEdge = true;
  }

  look(dx: number, dy: number): void {
    if (Number.isFinite(dx) && Number.isFinite(dy)) {
      this.dx += dx;
      this.dy += dy;
    }
  }

  /** Źródło zewnętrzne (pad, dotyk): ciągłe osie ruchu i bieg; łączone z klawiaturą jako większe wychylenie. */
  setExternal(x: number, y: number, run: boolean): void {
    this.ext = { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)), run };
  }

  /** Zwolnienie wszystkich klawiszy (utrata fokusu, wyjście z pointer lock). */
  releaseAll(): void {
    this.down.clear();
  }

  private any(codes: readonly string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  /** Odczyt akcji; zdarzenia jednorazowe i ruch myszy są zerowane. */
  consume(): PlayerIntent {
    const kx = (this.any(TPP_KEYS.right) ? 1 : 0) - (this.any(TPP_KEYS.left) ? 1 : 0);
    const ky = (this.any(TPP_KEYS.forward) ? 1 : 0) - (this.any(TPP_KEYS.back) ? 1 : 0);
    const pick = (a: number, b: number) => (Math.abs(b) > Math.abs(a) ? b : a);
    const intent: PlayerIntent = {
      moveX: pick(kx, this.ext.x),
      moveY: pick(ky, this.ext.y),
      run: this.any(TPP_KEYS.run) || this.ext.run,
      crouchToggle: this.crouchEdge,
      jump: this.jumpEdge,
      lookDx: this.dx,
      lookDy: this.dy,
    };
    this.crouchEdge = false;
    this.jumpEdge = false;
    this.dx = 0;
    this.dy = 0;
    return intent;
  }

  /**
   * Podpina klawiaturę i mysz do `window`/`document`. `isActive` mówi, czy sterowanie ma reagować (np. pointer lock aktywny);
   * klawisze działają zawsze, ruch myszy tylko przy aktywnym. Zwraca funkcję odpinającą (wołana też przez `dispose`).
   */
  attach(win: Target, doc: Target, isLookActive: () => boolean, ignore?: (e: unknown) => boolean): () => void {
    const key = (down: boolean) => (e: { code: string; repeat?: boolean; target?: unknown; preventDefault(): void }) => {
      if (ignore?.(e)) return;
      if (this.handleKey(e.code, down, e.repeat === true)) e.preventDefault();
    };
    const onDown = key(true);
    const onUp = key(false);
    const onBlur = () => this.releaseAll();
    const onMove = (e: { movementX: number; movementY: number }) => {
      if (isLookActive()) this.look(e.movementX, e.movementY);
    };
    win.addEventListener("keydown", onDown as Listener);
    win.addEventListener("keyup", onUp as Listener);
    win.addEventListener("blur", onBlur);
    doc.addEventListener("mousemove", onMove as Listener);
    const detach = () => {
      win.removeEventListener("keydown", onDown as Listener);
      win.removeEventListener("keyup", onUp as Listener);
      win.removeEventListener("blur", onBlur);
      doc.removeEventListener("mousemove", onMove as Listener);
    };
    this.detachers.push(detach);
    return detach;
  }

  dispose(): void {
    for (const d of this.detachers) d();
    this.detachers = [];
    this.down.clear();
  }
}
