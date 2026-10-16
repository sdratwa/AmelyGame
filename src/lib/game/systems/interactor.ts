import type { Command } from "../core/apply";
import { CHEST_PROMPT_RANGE } from "../core/constants";
import type { ChestId } from "../core/ids";
import type { GameState } from "../core/state";
import type { ItemId } from "../content/items";
import { CHEST_CONTENTS } from "./forestQuest";
import { describePrompt, interactionCommand, pickInteraction, type InteractTarget, type Prompt, type ViewPose } from "./interaction";

/** Po tylu ms od E na zamkniętej skrzyni pokazujemy okno zawartości (czas animacji pokrywy, patrz `CHEST_OPEN_SECONDS`). */
export const CHEST_WINDOW_DELAY_MS = 900;
/** Jak długo czekamy, aż stan gry potwierdzi otwarcie; po tym czasie uznajemy, że silnik odmówił. */
export const OPEN_CONFIRM_TIMEOUT_MS = 1500;

export type ChestWindowView = { id: ChestId; item: ItemId; taken: boolean };

export type InteractorSnapshot = {
  target: InteractTarget | null;
  prompt: Prompt | null;
  /** Okno zawartości skrzyni; null, gdy zamknięte lub skrzynia dopiero się otwiera. */
  window: ChestWindowView | null;
  /** Skrzynia w trakcie otwierania (pokrywa się unosi): E jest wtedy ignorowane. */
  opening: ChestId | null;
};

export type InteractorDeps = {
  getState: () => GameState;
  dispatch: (command: Command) => void;
  getPose: () => ViewPose | null;
  now: () => number;
};

/**
 * Logika interakcji w lesie (klawisz E, podpowiedź, okno skrzyni) bez Reacta i bez renderera. Źródłem prawdy jest stan
 * gry: kontroler tylko wybiera obiekt, wysyła komendy silnika i zapamiętuje, że okno skrzyni ma się pokazać po
 * zakończeniu animacji. Silnik i tak waliduje zasięg, obiekt i stan przy każdej komendzie.
 */
export class ForestInteractor {
  private pending: { id: ChestId; since: number; revealAt: number } | null = null;
  private windowFor: ChestId | null = null;
  private last: InteractorSnapshot = { target: null, prompt: null, window: null, opening: null };

  private deps: InteractorDeps | null;

  /** Zależności można podać później (`bind`), np. gdy są dostępne dopiero po zamontowaniu widoku. */
  constructor(deps?: InteractorDeps) {
    this.deps = deps ?? null;
  }

  bind(deps: InteractorDeps): void {
    this.deps = deps;
  }

  get snapshot(): InteractorSnapshot {
    return this.last;
  }

  /** Odświeża podpowiedź i okno na podstawie bieżącego stanu gry i pozycji; zwraca nową migawkę. */
  poll(): InteractorSnapshot {
    const deps = this.deps;
    if (!deps) return this.last;
    const state = deps.getState();
    const pose = deps.getPose();
    const now = deps.now();
    this.settle(state, pose, now);

    let target: InteractTarget | null = null;
    let prompt: Prompt | null = null;
    if (!this.windowFor && pose) {
      target = pickInteraction(state, pose);
      if (target && !(this.pending && target.kind === "chest" && target.id === this.pending.id)) prompt = describePrompt(state, target);
    }
    const next: InteractorSnapshot = {
      target,
      prompt,
      window: this.windowFor ? this.windowView(state, this.windowFor) : null,
      opening: this.pending?.id ?? null,
    };
    if (!sameSnapshot(this.last, next)) this.last = next;
    return this.last;
  }

  /**
   * Klawisz E (bez powtarzania). Zwraca true, gdy kontroler przejął klawisz (nic innego, np. jedzenie, nie powinno
   * reagować): jest cel interakcji, otwarte okno skrzyni albo trwa otwieranie.
   */
  press(): boolean {
    const deps = this.deps;
    if (!deps) return false;
    const state = deps.getState();
    const pose = deps.getPose();
    const now = deps.now();
    this.settle(state, pose, now);
    if (this.windowFor) {
      this.takeFromWindow();
      return true;
    }
    if (this.pending) return true;
    if (!pose || state.dead || state.view !== "forest") return false;
    const target = pickInteraction(state, pose);
    if (!target) return false;
    if (target.kind === "chest" && target.action === "peek") {
      this.windowFor = target.id;
      this.poll();
      return true;
    }
    const command = interactionCommand(target, pose);
    if (command) {
      if (command.type === "chest.open") this.pending = { id: command.id, since: now, revealAt: now + CHEST_WINDOW_DELAY_MS };
      deps.dispatch(command);
    }
    this.poll();
    return true;
  }

  /** Zabiera przedmiot z otwartej skrzyni (przycisk w oknie lub E). */
  takeFromWindow(): void {
    const id = this.windowFor;
    const pose = this.deps?.getPose();
    if (!id || !pose || !this.deps) return;
    this.deps.dispatch({ type: "chest.take", id, at: { x: pose.x, z: pose.z } });
    this.poll();
  }

  /** Zamyka okno bez zabierania: skrzynia zostaje otwarta, a przedmiot w środku. */
  closeWindow(): void {
    this.windowFor = null;
    this.poll();
  }

  /** Czyści stan sesji (np. po wyjściu z lasu). */
  reset(): void {
    this.pending = null;
    this.windowFor = null;
    this.last = { target: null, prompt: null, window: null, opening: null };
  }

  private settle(state: GameState, pose: ViewPose | null, now: number): void {
    if (state.view !== "forest" || state.dead || state.phase !== "playing") {
      this.pending = null;
      this.windowFor = null;
      return;
    }
    const p = this.pending;
    if (p) {
      if (state.chests[p.id]?.opened) {
        if (now >= p.revealAt) {
          this.pending = null;
          if (!state.chests[p.id].taken) this.windowFor = p.id;
        }
      } else if (now - p.since > OPEN_CONFIRM_TIMEOUT_MS) {
        this.pending = null;
      }
    }
    const w = this.windowFor;
    if (w) {
      const st = state.chests[w];
      const chest = pose ? chestDistance(state, w, pose) : Infinity;
      if (!st?.opened || st.taken || chest > CHEST_PROMPT_RANGE + 1.5) this.windowFor = null;
    }
  }

  private windowView(state: GameState, id: ChestId): ChestWindowView {
    return { id, item: CHEST_CONTENTS[id], taken: !!state.chests[id]?.taken };
  }
}

function chestDistance(state: GameState, id: ChestId, pose: ViewPose): number {
  const point = (state.world?.anchors?.chests as Record<string, { x: number; z: number } | undefined> | undefined)?.[id];
  return point ? Math.hypot(point.x - pose.x, point.z - pose.z) : Infinity;
}

function sameSnapshot(a: InteractorSnapshot, b: InteractorSnapshot): boolean {
  return (
    a.opening === b.opening &&
    a.target?.kind === b.target?.kind &&
    a.target?.id === b.target?.id &&
    (a.target?.kind === "chest" ? a.target.action : null) === (b.target?.kind === "chest" ? b.target.action : null) &&
    a.prompt?.text === b.prompt?.text &&
    a.prompt?.key === b.prompt?.key &&
    a.window?.id === b.window?.id &&
    a.window?.taken === b.window?.taken
  );
}
