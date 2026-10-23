import type { HsCancelReason, HsEvent, HsNoticeCode, HsOutcome, HsStateView } from "./types";

/** Polskie teksty zabawy w chowanego w jednym miejscu (interfejs nie wpisuje napisów na sztywno). */

export type Tone = "win" | "lose" | "info" | "cancel";
export type BannerText = { title: string; text: string; tone: Tone };

/** `mm:ss` z milisekund (zaokrąglone w górę do pełnej sekundy, żeby 0:00 oznaczało koniec). */
export function formatCountdown(ms: number | null): string {
  if (ms === null) return "--:--";
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export const INVITE = {
  title: "ZAPROSZENIE DO ZABAWY!",
  text: "Ktoś zaprasza Cię do wspólnej zabawy w chowanego! Masz ochotę znaleźć najlepszą kryjówkę w naszym lesie?",
  accept: "DOŁĄCZAM!",
  decline: "NIE TERAZ",
} as const;

export const ACTIONS = {
  hide: "TO MOJA KRYJÓWKA!",
  find: "ZNALAZŁEM!",
  resign: "REZYGNUJĘ Z ZABAWY",
  cancel: "ANULUJ ZABAWĘ",
  back: "WRÓĆ DO GRY",
} as const;

export const CONFIRM = {
  withdraw: { title: "Zrezygnować z zabawy?", text: "Wrócisz do normalnej gry, a runda potrwa bez Ciebie.", yes: "TAK, REZYGNUJĘ", no: "ZOSTAJĘ" },
  cancel: { title: "Anulować zabawę?", text: "Zabawa zakończy się dla wszystkich uczestników.", yes: "TAK, ANULUJ", no: "GRAMY DALEJ" },
} as const;

/** Etykieta fazy w kompaktowym HUD. */
export function phaseLabel(view: HsStateView): string {
  switch (view.phase) {
    case "INVITING":
      return view.timer === "join" ? "START ZA" : "ZAPROSZENIA";
    case "HIDING":
      return "CHOWANIE";
    case "SEEKING":
      return "SZUKANIE";
    default:
      return "";
  }
}

/** Jedna linia statusu pod licznikiem. */
export function statusLine(view: HsStateView): string {
  const role = view.you.role;
  if (view.phase === "INVITING") {
    const l = view.lobby;
    if (!l) return "";
    return view.you.isHost ? `Zaproszeni: ${l.invited} · dołączyli: ${l.accepted}` : "Czekamy na pozostałych uczestników!";
  }
  if (view.phase === "HIDING") {
    if (role === "SEEKER") return "Stoisz w miejscu i nie podglądasz.";
    if (role === "HIDER_LOCKED") return view.you.autoLocked ? "Kryjówka ustawiona automatycznie." : "Kryjówka gotowa. Czekaj na szukającego.";
    return "Znajdź kryjówkę!";
  }
  if (view.phase === "SEEKING") {
    const s = view.seek;
    if (role === "SEEKER" && s) return `Znaleziono: ${s.found}/${s.total} · Błędne próby: ${s.failed}/${s.maxFailed}`;
    if (role === "HIDER_LOCKED") return "Jesteś ukryty. Zostań na miejscu.";
    if (role === "HIDER_FOUND") return "Odnaleziono Cię! Możesz swobodnie chodzić.";
  }
  return "";
}

const pluralTry = (n: number) => (n === 1 ? "próbę" : n >= 2 && n <= 4 ? "próby" : "prób");

/** Baner dla jednorazowego zdarzenia z serwera. */
export function eventBanner(event: HsEvent, maxFailed: number): BannerText | null {
  if (event.kind === "hit") {
    return { title: "BRAWO! ZNALEZIONO GRACZA!", text: "Świetne oko! Jeszcze trochę i odnajdziesz wszystkich!", tone: "win" };
  }
  if (event.kind === "found") {
    return {
      title: "UDAŁO SIĘ CIĘ ODNALEŹĆ!",
      text: "Dobra kryjówka! Tym razem szukający Cię wypatrzył. Możesz już swobodnie odkrywać świat.",
      tone: "info",
    };
  }
  const left = maxFailed - event.failed;
  if (left >= 2) return { title: "JESZCZE NIE TUTAJ!", text: `Rozejrzyj się dokładniej. Masz jeszcze ${left === 2 ? "dwie" : left} ${pluralTry(left)}!`, tone: "info" };
  if (left === 1) return { title: "UWAŻAJ, OSTATNIA PRÓBA!", text: "Spokojnie, dasz radę! Podejdź bliżej i upewnij się, zanim sprawdzisz.", tone: "info" };
  return null;
}

/** Baner przejścia fazy lub roli (generowany z różnicy kolejnych widoków). */
export const BANNERS = {
  hidingHider: { title: "CZAS SIĘ SCHOWAĆ!", text: "Znajdź najlepszą kryjówkę, zanim rozpocznie się poszukiwanie!", tone: "info" },
  hidingSeeker: { title: "CHOWAMY SIĘ!", text: "Stój w miejscu i nie podglądaj. Za chwilę zaczniesz szukać!", tone: "info" },
  locked: { title: "KRYJÓWKA GOTOWA!", text: "Świetnie! Teraz pozostań na miejscu i poczekaj na szukającego.", tone: "win" },
  lockedAuto: { title: "KRYJÓWKA USTAWIONA!", text: "Czas na chowanie minął, więc zostajesz tam, gdzie stałeś. Poczekaj na szukającego.", tone: "info" },
  seekingSeeker: { title: "SZUKAMY!", text: "Okręgi na minimapie pokazują, gdzie warto szukać. Podejdź do ukrytej postaci i naciśnij ZNALAZŁEM!", tone: "info" },
  seekingHider: { title: "POSZUKIWANIA SIĘ ROZPOCZĘŁY!", text: "Zostań na miejscu i cierpliwie czekaj.", tone: "info" },
  lastThirty: { title: "OSTATNIE 30 SEKUND!", text: "Uważnie wypatruj świateł w lesie — kryjówki mogą się teraz zdradzić!", tone: "info" },
} as const satisfies Record<string, BannerText>;

export const NOTICES: Record<HsNoticeCode, string> = {
  NOT_IN_FOREST: "Wejdź do lasu, aby zacząć zabawę w chowanego.",
  SESSION_RUNNING: "W tym świecie trwa już zabawa w chowanego.",
  NO_PLAYERS: "Nie ma teraz nikogo, kogo można zaprosić. Poczekaj na innych graczy!",
  HIDE_AIRBORNE: "Najpierw stań na stabilnym podłożu!",
  HIDE_ILLEGAL: "Tu nie można się schować. Wybierz inne miejsce!",
  HIDE_STALE: "Poczekaj chwilę i spróbuj jeszcze raz.",
  FIND_STALE: "Poczekaj chwilę i spróbuj jeszcze raz.",
  WORLD_BLOCKED: "W trakcie zabawy nie można tego robić.",
  LEAVE_BLOCKED: "W trakcie zabawy nie możesz wyjść z lasu. Zrezygnuj z zabawy w menu.",
  OFFLINE: "Zabawa w chowanego jest dostępna w grze online.",
};

const CANCEL_TEXT: Record<HsCancelReason, string> = {
  HOST_CANCELLED: "Organizator zakończył zabawę.",
  NOBODY_JOINED: "Nikt nie dołączył do zabawy. Spróbujcie jeszcze raz!",
  SEEKER_WITHDREW: "Szukający zrezygnował, więc zabawa została anulowana.",
  SEEKER_LEFT: "Szukający stracił połączenie, więc zabawa została anulowana.",
  NO_PLAYERS: "Zabrakło uczestników, więc zabawa została anulowana.",
};

export const OUTCOME_BADGE: Record<HsOutcome, string> = { WIN: "ZWYCIĘSTWO", LOSE: "PORAŻKA", WITHDRAWN: "REZYGNACJA", CANCELLED: "ANULOWANO" };

export type ResultText = { title: string; text: string; badge: string; tone: Tone };

/** Ekran końcowy dla gracza (null: nie pokazujemy, np. po własnej rezygnacji). */
export function resultText(view: HsStateView): ResultText | null {
  const r = view.result;
  if (!r) return null;
  const outcome = r.you;
  const badge = OUTCOME_BADGE[outcome];
  if (outcome === "WITHDRAWN") return null;
  if (outcome === "CANCELLED") {
    const reason = r.reason as HsCancelReason;
    return { title: "ZABAWA ANULOWANA", text: CANCEL_TEXT[reason] ?? "Zabawa została anulowana.", badge, tone: "cancel" };
  }
  if (view.you.isHost) {
    return outcome === "WIN"
      ? { title: "WSPANIALE! WSZYSCY ODNALEZIENI!", text: "Masz świetne oko i doskonałą orientację! Udało Ci się odnaleźć wszystkie kryjówki!", badge, tone: "win" }
      : {
          title: "TYM RAZEM KRYJÓWKI WYGRAŁY!",
          text: "Las skrywa wiele tajemnic! Następnym razem na pewno wypatrzysz jeszcze więcej. Świetnie się bawiłeś!",
          badge,
          tone: "lose",
        };
  }
  return outcome === "WIN"
    ? { title: "NIE DO ZNALEZIENIA!", text: "Brawo! Twoja kryjówka okazała się znakomita. Udało Ci się pozostać w ukryciu do końca zabawy!", badge, tone: "win" }
    : {
        title: "ZNALEZIONO CIĘ — DOBRA ZABAWA!",
        text: "Tym razem szukający był sprytniejszy. Ale każda kryjówka to nowe doświadczenie — następnym razem możesz wygrać!",
        badge,
        tone: "lose",
      };
}

export const REASON_LINE: Record<string, string> = {
  ALL_FOUND: "Wszyscy ukrywający się zostali odnalezieni.",
  TIME_UP: "Czas poszukiwań minął.",
  TOO_MANY_MISSES: "Szukający wykorzystał wszystkie próby.",
};
