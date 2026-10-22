import type { Command } from "../core/apply";
import { BUILD_PROMPT_RANGE, CHEST_PROMPT_RANGE } from "../core/constants";
import type { ChestId } from "../core/ids";
import type { GameState } from "../core/state";
import type { ItemId } from "../content/items";
import { CHEST_CONTENTS } from "./forestQuest";
import { describePrompt, interactionCommand, pickInteraction, type InteractTarget, type PickOptions, type Prompt, type ViewPose } from "./interaction";

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
  /** Okno budowy mostu (E przy miejscu budowy z schematem); komendę wysyła dopiero przycisk w oknie. */
  buildWindow: boolean;
};

export type InteractorDeps = {
  getState: () => GameState;
  dispatch: (command: Command) => void;
  getPose: () => ViewPose | null;
  now: () => number;
  /** Tryb trzecioosobowy: cel musi być osiągalny po czystej linii od postaci (patrz `PickOptions`). */
  requireClearReach?: () => boolean;
};

/**
 * Logika interakcji w lesie (klawisz E, podpowiedź, okno skrzyni) bez Reacta i bez renderera. Źródłem prawdy jest stan
 * gry: kontroler tylko wybiera obiekt, wysyła komendy silnika i zapamiętuje, że okno skrzyni ma się pokazać po
 * zakończeniu animacji. Silnik i tak waliduje zasięg, obiekt i stan przy każdej komendzie.
 */
export class ForestInteractor {
  private pending: { id: ChestId; since: number; revealAt: number } | null = null;
  private windowFor: ChestId | null = null;
  private buildOpen = false;
  private last: InteractorSnapshot = { target: null, prompt: null, window: null, opening: null, buildWindow: false };

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
    if (this.discoverIfCrossed(state, pose)) return this.poll();

    let target: InteractTarget | null = null;
    let prompt: Prompt | null = null;
    if (!this.windowFor && !this.buildOpen && pose) {
      target = pickInteraction(state, pose, this.pickOptions());
      if (target && !(this.pending && target.kind === "chest" && target.id === this.pending.id)) prompt = describePrompt(state, target);
    }
    const next: InteractorSnapshot = {
      target,
      prompt,
      window: this.windowFor ? this.windowView(state, this.windowFor) : null,
      opening: this.pending?.id ?? null,
      buildWindow: this.buildOpen,
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
    if (this.pending || this.buildOpen) return true;
    if (!pose || state.dead || state.view !== "forest") return false;
    const target = pickInteraction(state, pose, this.pickOptions());
    if (!target) return false;
    if (target.kind === "bridge_site") {
      // Bez schematu to tylko komunikat (podpowiedź); z schematem E otwiera okno budowy.
      if (target.hasBlueprint) {
        this.buildOpen = true;
        this.poll();
      }
      return true;
    }
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

  /**
   * Przejście przez most: gdy most stoi, a gracz dotarł na drugi brzeg (w promieniu obszaru "za rzeką"), wysyłamy
   * `region.discover`. To jedyny sposób odkrycia: nie ma przycisku ani teleportu. Silnik sam sprawdza dystans, flagę
   * mostu i to, czy region nie został już odkryty, więc powtórzenie jest nieszkodliwe.
   */
  private discoverIfCrossed(state: GameState, pose: ViewPose | null): boolean {
    const deps = this.deps;
    const beyond = state.world?.anchors?.beyond;
    if (!deps || !pose || !beyond || state.view !== "forest" || state.dead || state.phase !== "playing") return false;
    if (!state.bridge.built || state.discovered.includes(beyond.region)) return false;
    if (Math.hypot(beyond.x - pose.x, beyond.z - pose.z) > beyond.radius) return false;
    deps.dispatch({ type: "region.discover", id: beyond.region, at: { x: pose.x, z: pose.z } });
    return !!deps.getState().discovered.includes(beyond.region);
  }

  /** Przycisk "Zbuduj most" w oknie budowy: jedyna droga do komendy; silnik ponownie sprawdza schemat, materiały i miejsce. */
  confirmBuild(): void {
    const pose = this.deps?.getPose();
    if (!this.buildOpen || !pose || !this.deps) return;
    this.deps.dispatch({ type: "bridge.build", at: { x: pose.x, z: pose.z } });
    this.buildOpen = false;
    this.poll();
  }

  /** Zamyka okno budowy bez budowania. */
  closeBuildWindow(): void {
    this.buildOpen = false;
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
    this.buildOpen = false;
    this.last = { target: null, prompt: null, window: null, opening: null, buildWindow: false };
  }

  private settle(state: GameState, pose: ViewPose | null, now: number): void {
    if (state.view !== "forest" || state.dead || state.phase !== "playing") {
      this.pending = null;
      this.windowFor = null;
      this.buildOpen = false;
      return;
    }
    if (this.buildOpen) {
      const site = state.world?.anchors?.bridge.west;
      const far = !pose || !site || Math.hypot(site.x - pose.x, site.z - pose.z) > BUILD_PROMPT_RANGE + 1.5;
      if (state.bridge.built || far) this.buildOpen = false;
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

  private pickOptions(): PickOptions {
    return { requireClearReach: this.deps?.requireClearReach?.() ?? false };
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
    a.window?.taken === b.window?.taken &&
    a.buildWindow === b.buildWindow
  );
}
