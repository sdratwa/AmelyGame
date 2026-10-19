/**
 * Zachowanie NPC wobec zbliżającego się gracza (czysta logika, bez Three.js i bez stanu gry): patrol, alert, zauważenie
 * gracza, dialog i reakcje. Maszyna stanów dostaje tylko dystans, czas i zdarzenia końca animacji; ruch i animacje wykonuje
 * `EncounterBody` (troll), więc ta sama maszyna obsłuży później prawdziwy dialog T1: wystarczy wywołać `resolveDialog`.
 *
 *   PATROL --(< 20 m, zwłoka)--> ALERT --(< 5 m)--> NOTICE (obrót) -> SURPRISED -> DIALOG
 *   DIALOG --correct--> CELEBRATE (Happy -> Dance) | --wrong--> ANGRY | --dismissed--> ALERT/PATROL
 *   ALERT --(> 22 m, zwłoka)--> PATROL
 *
 * Histereza: wejście w alert poniżej 20 m (po 0,3 s), wyjście dopiero powyżej 22 m (po 1,5 s). Zauważenie (Surprised +
 * dialog) następuje raz na spotkanie: po nim spotkanie jest "rozbrojone", aż gracz oddali się na 10 m (na 0,5 s) albo
 * zostanie świadomie ponowione (`restart`, `requestTalk`).
 */

export const ENCOUNTER = {
  alertEnter: 20,
  alertExit: 22,
  alertEnterDelay: 0.3,
  alertExitDelay: 1.5,
  notice: 5,
  /** Gracz, który cofnie się dalej niż to w trakcie obrotu (przed Surprised), nie wywołuje reakcji. */
  noticeAbort: 7,
  rearm: 10,
  rearmDelay: 0.5,
  /** Obrót uznajemy za zakończony, gdy kąt do gracza jest mniejszy niż to (rad). */
  facingTolerance: 0.12,
  firstNervousDelay: 1.2,
  nervousGapMin: 3.5,
  nervousGapMax: 7,
  /** Zasięg świadomej rozmowy (E). */
  talkRange: 4.5,
} as const;

export type EncounterState = "patrol" | "alert" | "notice" | "surprised" | "dialog" | "celebrate" | "angry";
export type DialogOutcome = "correct" | "wrong" | "dismissed";

/** Czynności, które maszyna zleca postaci. Implementuje je `TrollNpc`. */
export interface EncounterBody {
  /** Patrol działa normalnie (chód od punktu do punktu i postoje). */
  runPatrol(): void;
  /** Patrol zatrzymuje się łagodnie, a postać obraca się ku graczowi, jeśli `face`. */
  stopPatrol(face: boolean): void;
  /** Postać stoi (prędkość 0). */
  readonly atRest: boolean;
  /** Bezwzględny kąt między kierunkiem postaci a graczem (rad). */
  readonly yawError: number;
  /** Czy gra animacja jednorazowa, której nie wolno przerwać. */
  readonly locked: boolean;
  /** Czy gra jakakolwiek reakcja jednorazowa. */
  readonly reacting: boolean;
  /** Stan podstawowy animacji (pętla): chód albo spoczynek. */
  setBase(state: "walk" | "idle"): void;
  /** Reakcja jednorazowa z łańcuchem następnych; false, gdy nie można jej zagrać. */
  play(state: string, then?: readonly string[]): boolean;
  /** Płynne przerwanie reakcji, jeśli wolno; true, gdy żadna nie gra. */
  cancelReaction(): boolean;
}

export type EncounterEvents = {
  /** Troll zwrócił się do gracza i skończył Surprised: otwórz dialog (testowy lub prawdziwy T1). */
  onDialogRequested?: () => void;
  onStateChange?: (from: EncounterState, to: EncounterState) => void;
};

export type EncounterInput = { distance: number };

export class TrollEncounter {
  private current: EncounterState = "patrol";
  private armed = true;
  private rearmTimer = 0;
  private enterTimer = 0;
  private exitTimer = 0;
  private nervousTimer = 0;
  private distance = Infinity;
  private encounters = 0;
  private disposed = false;

  constructor(
    private readonly body: EncounterBody,
    private readonly rng: () => number,
    private readonly events: EncounterEvents = {},
  ) {}

  get state(): EncounterState {
    return this.current;
  }

  /** Czy kolejne zbliżenie (< 5 m) wywoła zauważenie. */
  get isArmed(): boolean {
    return this.armed;
  }

  /** Liczba spotkań, w których troll zauważył gracza (odtworzył Surprised), od początku. */
  get encounterCount(): number {
    return this.encounters;
  }

  get dialogActive(): boolean {
    return this.current === "dialog";
  }

  /** Sekwencja, której nie przerywa zmiana odległości (Surprised, dialog, Happy/Dance, Angry). */
  get busy(): boolean {
    return this.current === "surprised" || this.current === "dialog" || this.current === "celebrate" || this.current === "angry";
  }

  private enter(next: EncounterState): void {
    if (next === this.current) return;
    const from = this.current;
    this.current = next;
    this.enterTimer = 0;
    this.exitTimer = 0;
    this.events.onStateChange?.(from, next);
  }

  update(dt: number, input: EncounterInput): void {
    if (this.disposed) return;
    const step = Math.max(0, dt);
    const d = input.distance;
    this.distance = d;
    if (!this.armed) {
      if (d > ENCOUNTER.rearm) {
        this.rearmTimer += step;
        if (this.rearmTimer >= ENCOUNTER.rearmDelay) this.armed = true;
      } else this.rearmTimer = 0;
    }
    switch (this.current) {
      case "patrol":
        this.updatePatrol(step, d);
        break;
      case "alert":
        this.updateAlert(step, d);
        break;
      case "notice":
        this.updateNotice(d);
        break;
      case "surprised":
      case "dialog":
      case "celebrate":
      case "angry":
        this.body.stopPatrol(true);
        this.syncBase();
        break;
    }
  }

  private syncBase(): void {
    this.body.setBase(this.body.atRest ? "idle" : "walk");
  }

  private updatePatrol(step: number, d: number): void {
    this.body.runPatrol();
    if (this.armed && d < ENCOUNTER.notice) return this.beginNotice();
    if (d < ENCOUNTER.alertEnter) {
      this.enterTimer += step;
      if (this.enterTimer >= ENCOUNTER.alertEnterDelay) this.beginAlert();
    } else this.enterTimer = 0;
  }

  private beginAlert(): void {
    this.enter("alert");
    this.nervousTimer = ENCOUNTER.firstNervousDelay;
  }

  private updateAlert(step: number, d: number): void {
    if (this.armed && d < ENCOUNTER.notice) return this.beginNotice();
    if (d > ENCOUNTER.alertExit) {
      this.exitTimer += step;
      if (this.exitTimer >= ENCOUNTER.alertExitDelay) {
        this.body.cancelReaction();
        this.enter("patrol");
        this.body.runPatrol();
        return;
      }
    } else this.exitTimer = 0;
    this.body.stopPatrol(false);
    this.syncBase();
    if (!this.body.atRest || this.body.reacting) return;
    this.nervousTimer -= step;
    if (this.nervousTimer > 0) return;
    if (this.body.play("nervous")) {
        this.nervousTimer = ENCOUNTER.nervousGapMin + this.rng() * (ENCOUNTER.nervousGapMax - ENCOUNTER.nervousGapMin);
    } else this.nervousTimer = 0.5;
  }

  private beginNotice(): void {
    this.enter("notice");
    this.body.cancelReaction();
  }

  private updateNotice(d: number): void {
    if (d > ENCOUNTER.noticeAbort) {
      this.enter("alert");
      this.nervousTimer = ENCOUNTER.firstNervousDelay;
      return;
    }
    this.body.cancelReaction();
    this.body.stopPatrol(true);
    this.syncBase();
    if (this.body.atRest && !this.body.reacting && this.body.yawError < ENCOUNTER.facingTolerance && this.body.play("surprised")) {
      this.armed = false;
      this.rearmTimer = 0;
      this.encounters += 1;
      this.enter("surprised");
    }
  }

  /** Koniec klipu jednorazowego (zdarzenie `finished` animatora). */
  animationFinished(state: string): void {
    if (this.disposed) return;
    if (this.current === "surprised" && state === "surprised") {
      this.enter("dialog");
      this.events.onDialogRequested?.();
    } else if (this.current === "celebrate" && state === "dance") this.afterSequence();
    else if (this.current === "angry" && state === "angry") this.afterSequence();
  }

  private afterSequence(): void {
    this.enter(this.distance < ENCOUNTER.alertExit ? "alert" : "patrol");
    this.nervousTimer = ENCOUNTER.firstNervousDelay + 1;
  }

  /** Wynik dialogu (testowego lub prawdziwego): jedyne wejście, którym dialog steruje zachowaniem trolla. */
  resolveDialog(outcome: DialogOutcome): boolean {
    if (this.current !== "dialog" || this.disposed) return false;
    if (outcome === "correct") {
      if (!this.body.play("happy", ["dance"])) return false;
      this.enter("celebrate");
    } else if (outcome === "wrong") {
      if (!this.body.play("angry")) return false;
      this.enter("angry");
    } else {
      this.enter(this.distance < ENCOUNTER.alertExit ? "alert" : "patrol");
        this.nervousTimer = ENCOUNTER.firstNervousDelay + 1;
    }
    return true;
  }

  /** Gniew po nieudanej interakcji z gry (np. próba otwarcia pilnowanej skrzyni): tylko poza sekwencją spotkania. */
  reactAngry(): boolean {
    if (this.disposed || this.busy) return false;
    if (!this.body.cancelReaction() || !this.body.play("angry")) return false;
    this.enter("angry");
    return true;
  }

  /** Testowe ponowienie spotkania bez resetowania gry: zbrojenie i powrót do zwykłej oceny dystansu. */
  restart(): boolean {
    if (this.disposed || this.busy) return false;
    this.armed = true;
    this.rearmTimer = 0;
    return true;
  }

  /** Świadoma rozmowa (E) z bliska: zbrojenie spotkania, jeśli gracz jest w zasięgu. */
  requestTalk(): boolean {
    if (this.disposed || this.busy || this.distance > ENCOUNTER.talkRange) return false;
    return this.restart();
  }

  /** Czy E może rozpocząć rozmowę (do podpowiedzi). */
  get canTalk(): boolean {
    return !this.disposed && !this.busy && this.distance <= ENCOUNTER.talkRange && this.current !== "notice";
  }

  dispose(): void {
    this.disposed = true;
  }
}
