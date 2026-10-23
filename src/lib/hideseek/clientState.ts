import { BANNERS, eventBanner, type BannerText } from "./texts";
import { FREE_GATE, type HsEvent, type HsNoticeCode, type HsPhase, type HsStateView, type MovementGate } from "./types";

export type HsCorrection = { x: number; y: number; z: number; seq: number };
export type ActiveBanner = BannerText & { id: number; until: number };

const BANNER_MS = 4500;

/**
 * Stan zabawy po stronie klienta. Czysta logika (bez sieci i DOM): serwer jest źródłem prawdy, ten obiekt tylko
 * przechowuje ostatni widok, porządkuje go po `rev` (spóźnione pakiety nie cofają stanu), liczy czas do końca fazy
 * względem lokalnego zegara z poprawką na opóźnienie sieci i kolejkuje jednorazowe zdarzenia dla interfejsu.
 */
export class HideSeekClientState {
  view: HsStateView | null = null;
  private receivedAt = 0;
  private deadlineAt: number | null = null;
  private bannerValue: ActiveBanner | null = null;
  private bannerSeq = 0;
  private ver = 0;
  private noticeValue: { code: HsNoticeCode; at: number } | null = null;
  private correctionValue: HsCorrection | null = null;
  private correctionSeq = 0;
  private dismissed = new Set<string>();
  private confirmValue: "withdraw" | "cancel" | null = null;
  private listeners = new Set<() => void>();

  constructor(private readonly clock: () => number = () => performance.now(), private readonly rtt: () => number = () => 0) {}

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private emit() {
    this.ver++;
    for (const l of this.listeners) l();
  }
  /** Licznik zmian (do `useSyncExternalStore`). */
  get version(): number {
    return this.ver;
  }

  /** Przyjmuje widok z serwera; zwraca true, jeśli stan się zmienił. */
  accept(view: HsStateView | null): boolean {
    if (!view || typeof view !== "object" || typeof view.rev !== "number") return false;
    if (this.dismissed.has(view.sessionId)) return false;
    if (this.view && this.view.sessionId === view.sessionId && view.rev <= this.view.rev) return false;
    const now = this.clock();
    const prev = this.view;
    this.view = view;
    this.announce(prev, view, now);
    this.receivedAt = now;
    this.deadlineAt = view.endsInMs === null ? null : now + view.endsInMs - this.rtt() / 2;
    this.emit();
    return true;
  }

  /** Pozostały czas bieżącej fazy (ms) według zegara serwera, albo null. */
  remainingMs(now = this.clock()): number | null {
    return this.deadlineAt === null ? null : Math.max(0, this.deadlineAt - now);
  }

  get phase(): HsPhase {
    return this.view?.phase ?? "INACTIVE";
  }
  /** Zabawa trwa dla tego gracza (zaproszenie, ukrywanie albo szukanie) i gracz w niej uczestniczy lub jest zaproszony. */
  get running(): boolean {
    const p = this.phase;
    return p === "INVITING" || p === "HIDING" || p === "SEEKING";
  }
  /** Gracz jest uczestnikiem aktywnej fazy (ograniczone interakcje, blokada wyjścia z lasu). */
  get restricted(): boolean {
    return this.view?.you.restricted === true;
  }
  get gate(): MovementGate {
    return this.view && (this.view.phase === "HIDING" || this.view.phase === "SEEKING") ? this.view.gate : FREE_GATE;
  }
  get result() {
    return this.view?.result ?? null;
  }

  private banner(b: BannerText, now = this.clock()) {
    this.bannerValue = { ...b, id: ++this.bannerSeq, until: now + BANNER_MS };
  }

  /** Baner z różnicy kolejnych widoków (przejście fazy lub roli). Nowa sesja liczy się jako przejście z "brak". */
  private announce(prev: HsStateView | null, next: HsStateView, now: number) {
    const same = prev !== null && prev.sessionId === next.sessionId;
    const role = next.you.role;
    const wasPhase = same ? prev.phase : "INACTIVE";
    const wasRole = same ? prev.you.role : null;
    if (next.phase === "HIDING" && wasPhase !== "HIDING") {
      if (role === "SEEKER") this.banner(BANNERS.hidingSeeker, now);
      else if (role) this.banner(BANNERS.hidingHider, now);
    } else if (next.phase === "HIDING" && role === "HIDER_LOCKED" && wasRole === "HIDER_MOVING") {
      this.banner(next.you.autoLocked ? BANNERS.lockedAuto : BANNERS.locked, now);
    } else if (next.phase === "SEEKING" && wasPhase !== "SEEKING") {
      if (role === "SEEKER") this.banner(BANNERS.seekingSeeker, now);
      else if (role === "HIDER_LOCKED") this.banner(wasRole === "HIDER_MOVING" && !next.you.autoLocked ? BANNERS.locked : BANNERS.seekingHider, now);
    } else if (role === "SEEKER" && next.seek?.lastThirty && !(same && prev.seek?.lastThirty)) {
      this.banner(BANNERS.lastThirty, now);
    }
  }

  /** Jednorazowe zdarzenie z serwera (znaleziono / pudło) zamienia się w baner. */
  pushEvent(event: HsEvent) {
    const b = eventBanner(event, this.view?.config.maxFailed ?? 3);
    if (b) this.banner(b);
    this.emit();
  }
  /** Baner do pokazania teraz (null po upływie czasu). */
  activeBanner(now = this.clock()): ActiveBanner | null {
    return this.bannerValue && now < this.bannerValue.until ? this.bannerValue : null;
  }

  setNotice(code: HsNoticeCode) {
    this.noticeValue = { code, at: this.clock() };
    this.emit();
  }
  notice(maxAgeMs = 4000): HsNoticeCode | null {
    return this.noticeValue && this.clock() - this.noticeValue.at <= maxAgeMs ? this.noticeValue.code : null;
  }

  setCorrection(x: number, y: number, z: number) {
    this.correctionValue = { x, y, z, seq: ++this.correctionSeq };
  }
  /** Odbiera oczekującą korektę pozycji (raz). */
  takeCorrection(): HsCorrection | null {
    const c = this.correctionValue;
    this.correctionValue = null;
    return c;
  }

  /** Okno potwierdzenia rezygnacji (uczestnik) albo anulowania (organizator); otwierane z menu i ustawień. */
  get confirm(): "withdraw" | "cancel" | null {
    return this.confirmValue;
  }
  askConfirm(kind: "withdraw" | "cancel" | null) {
    this.confirmValue = kind;
    this.emit();
  }

  /** Gracz zamknął ekran wyniku / odrzucił ekran anulowania: stan zabawy znika lokalnie. */
  dismiss() {
    if (this.view) this.dismissed.add(this.view.sessionId);
    this.view = null;
    this.deadlineAt = null;
    this.bannerValue = null;
    this.confirmValue = null;
    this.emit();
  }

  /** Rozłączenie: widok z serwera przestaje być wiarygodny (po powrocie przyjdzie świeży). */
  reset() {
    this.view = null;
    this.deadlineAt = null;
    this.bannerValue = null;
    this.correctionValue = null;
    this.noticeValue = null;
    this.confirmValue = null;
    this.emit();
  }
}

/** Co może zrobić gracz z menu: zrezygnować (uczestnik), anulować (organizator) albo nic (poza zabawą). */
export function resignKindOf(view: HsStateView | null): "withdraw" | "cancel" | null {
  if (!view || view.phase === "FINISHED" || view.phase === "CANCELLED" || view.phase === "INACTIVE") return null;
  if (view.you.isHost) return "cancel";
  if (view.phase === "INVITING") return view.you.invite === "accepted" ? "withdraw" : null;
  return view.you.role && view.you.role !== "WITHDRAWN" ? "withdraw" : null;
}
