"use client";

import { useEffect, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import { EyeOff, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useInputActions } from "@/components/input/hooks";
import type { MultiplayerClient } from "@/lib/multiplayer/client";
import type { HsStateView } from "@/lib/hideseek/types";
import { ACTIONS, CONFIRM, INVITE, NOTICES, REASON_LINE, OUTCOME_BADGE, formatCountdown, phaseLabel, resultText, statusLine, type Tone } from "@/lib/hideseek/texts";
import { HIDESEEK_KEY, isGameLetterShortcut } from "@/lib/input/shortcuts";
import { isHubSource } from "@/lib/input/actions";
import { preferredInitialFocus } from "@/lib/input/domNavigator";
import { cn } from "@/lib/utils";

const POLL_MS = 250;

type Primary = "hide" | "find" | null;

/** Kontekstowa akcja gracza: schowanie się (ukrywający w fazie chowania) albo „znalazłem” (szukający w poszukiwaniach). */
export function primaryAction(view: HsStateView | null): Primary {
  if (!view) return null;
  if (view.phase === "HIDING" && view.you.role === "HIDER_MOVING") return "hide";
  if (view.phase === "SEEKING" && view.you.role === "SEEKER") return "find";
  return null;
}

const TONE: Record<Tone, string> = {
  win: "from-amber-300 to-yellow-200 text-amber-950",
  lose: "from-sky-300 to-indigo-200 text-indigo-950",
  info: "from-emerald-300 to-teal-200 text-emerald-950",
  cancel: "from-slate-300 to-slate-200 text-slate-900",
};

/**
 * Nakładka zabawy w chowanego: zaproszenie, poczekalnia, kompaktowy HUD, przycisk akcji, banery, potwierdzenia i ekran
 * wyników. Niczego nie rozstrzyga - pokazuje stan z serwera (`MultiplayerClient.hs`) i wysyła zamiary. Gdy zabawa jest
 * wyłączona, komponent nie rysuje nic.
 */
export function HideSeekLayer({
  multiplayer,
  touchUi,
  inForest,
  blocked,
  onModalChange,
}: {
  multiplayer?: MultiplayerClient;
  touchUi: boolean;
  inForest: boolean;
  /** Gra jest wstrzymana oknem (menu, dialog): klawisz akcji nie działa. */
  blocked: boolean;
  /** Informuje GameApp, że okno modalne zabawy zasłania grę (wejście sceny jest wtedy wstrzymane). */
  onModalChange: (open: boolean) => void;
}) {
  if (!multiplayer) return null;
  return <Layer client={multiplayer} touchUi={touchUi} inForest={inForest} blocked={blocked} onModalChange={onModalChange} />;
}

function Layer({ client, touchUi, inForest, blocked, onModalChange }: { client: MultiplayerClient; touchUi: boolean; inForest: boolean; blocked: boolean; onModalChange: (open: boolean) => void }) {
  const hs = client.hs;
  useSyncExternalStore(hs.subscribe.bind(hs), () => hs.version, () => 0);
  const [, setTick] = useState(0);
  const view = hs.view;
  const banner = hs.activeBanner();
  const notice = hs.notice();
  const confirm = hs.confirm;
  const action = primaryAction(view);
  const invite = view?.phase === "INVITING" && view.you.invite === "pending" && !view.you.isHost;
  const result = view && (view.phase === "FINISHED" || view.phase === "CANCELLED") ? resultText(view) : null;
  const modal = invite || confirm !== null || result !== null;
  const animated = view !== null || banner !== null || notice !== null;

  // Odliczanie i wygasanie banerów: lekki zegar tylko wtedy, gdy jest co odświeżać.
  useEffect(() => {
    if (!animated) return;
    const id = setInterval(() => setTick((n) => n + 1), POLL_MS);
    return () => clearInterval(id);
  }, [animated]);

  useEffect(() => {
    onModalChange(modal);
    if (modal) document.exitPointerLock?.();
    return () => onModalChange(false);
  }, [modal, onModalChange]);

  const perform = () => {
    if (action === "hide") client.hsHide();
    else if (action === "find") client.hsFound();
  };

  useEffect(() => {
    if (!action || blocked || !inForest) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isGameLetterShortcut(e, HIDESEEK_KEY)) return;
      e.preventDefault();
      if (action === "hide") client.hsHide();
      else client.hsFound();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [action, blocked, inForest, client]);

  useInputActions((e) => {
    if (e.action !== "hideSeek" || !isHubSource(e.source)) return false;
    if (!action || blocked || !inForest) return true;
    perform();
    return true;
  });

  if (!view && !banner && !notice) return null;
  const remaining = hs.remainingMs();
  const showHud = inForest && !!view && (view.phase === "HIDING" || view.phase === "SEEKING") && view.you.role !== null && view.you.role !== "WITHDRAWN";
  const lobby = inForest && !!view && view.phase === "INVITING" && (view.you.isHost || view.you.invite === "accepted");
  const hudTop = touchUi ? "top-[calc(max(0.25rem,var(--sat))+3rem)]" : "top-14";

  return (
    <div data-testid="hideseek-layer" className="pointer-events-none absolute inset-0 z-[18]">
      {lobby && view && (
        <div data-testid="hideseek-lobby" role="status" className={cn("absolute left-1/2 w-[min(92vw,22rem)] -translate-x-1/2 rounded-2xl bg-slate-900/80 px-4 py-2 text-center text-white shadow-xl backdrop-blur", hudTop)}>
          <p className="text-[11px] font-bold tracking-wide text-amber-200">{phaseLabel(view)}</p>
          {view.timer === "join" && <p className="text-2xl font-extrabold tabular-nums">{formatCountdown(remaining)}</p>}
          <p className="text-xs text-slate-200">{statusLine(view)}</p>
          {view.you.isHost && view.lobby?.roster && (
            <ul className="mt-1 flex flex-wrap justify-center gap-1" aria-label="Uczestnicy">
              {view.lobby.roster.map((r, i) => (
                <li key={i} className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", r.status === "accepted" ? "bg-emerald-400/90 text-emerald-950" : r.status === "declined" ? "bg-slate-500/80 text-white" : "bg-amber-200/90 text-amber-950")}>
                  {r.name}: {r.status === "accepted" ? "dołącza" : r.status === "declined" ? "nie teraz" : "czeka…"}
                </li>
              ))}
            </ul>
          )}
          {view.you.isHost && (
            <Button type="button" size="sm" variant="secondary" className="pointer-events-auto mt-2" data-testid="hideseek-lobby-cancel" onClick={() => hs.askConfirm("cancel")}>
              {ACTIONS.cancel}
            </Button>
          )}
        </div>
      )}

      {showHud && view && (
        <div data-testid="hideseek-hud" role="status" className={cn("absolute left-1/2 -translate-x-1/2 rounded-2xl bg-slate-900/75 px-3 py-1.5 text-center text-white shadow-lg backdrop-blur", hudTop, touchUi ? "max-w-[min(70vw,18rem)]" : "max-w-[24rem]")}>
          <p className="flex items-center justify-center gap-2 text-[11px] font-bold tracking-wide text-amber-200">
            <span>{phaseLabel(view)}</span>
            <span data-testid="hideseek-timer" className={cn("text-base tabular-nums text-white", view.seek?.lastThirty && "text-amber-300")}>
              {formatCountdown(remaining)}
            </span>
          </p>
          <p className="text-[11px] leading-tight text-slate-200">{statusLine(view)}</p>
        </div>
      )}

      {inForest && action && !blocked && (
        <PrimaryButton action={action} touchUi={touchUi} onPress={perform} />
      )}

      {banner && (
        <div key={banner.id} data-testid="hideseek-banner" role="alert" className="absolute inset-x-0 top-[22%] flex justify-center px-4">
          <div className={cn("max-w-md rounded-3xl bg-gradient-to-br px-5 py-3 text-center shadow-2xl animate-in fade-in zoom-in-95 motion-reduce:animate-none", TONE[banner.tone])}>
            <p className="text-xl font-extrabold leading-tight sm:text-2xl">{banner.title}</p>
            <p className="mt-1 text-sm font-medium leading-snug">{banner.text}</p>
          </div>
        </div>
      )}

      {notice && !banner && (
        <div data-testid="hideseek-notice" role="status" className="absolute inset-x-0 top-[22%] flex justify-center px-4">
          <p className="max-w-md rounded-full bg-slate-900/85 px-4 py-2 text-center text-sm font-semibold text-white shadow-xl">{NOTICES[notice]}</p>
        </div>
      )}

      <InviteDialog open={invite} view={view} onAnswer={(accept) => client.hsRespond(accept)} />
      <ConfirmDialog
        kind={confirm}
        onNo={() => hs.askConfirm(null)}
        onYes={() => {
          const kind = hs.confirm;
          hs.askConfirm(null);
          if (kind === "cancel") client.hsCancel();
          else if (kind === "withdraw") client.hsWithdraw();
        }}
      />
      <ResultDialog view={view} onClose={() => hs.dismiss()} />
    </div>
  );
}

function PrimaryButton({ action, touchUi, onPress }: { action: "hide" | "find"; touchUi: boolean; onPress: () => void }) {
  const Icon = action === "hide" ? EyeOff : Search;
  const label = action === "hide" ? ACTIONS.hide : ACTIONS.find;
  const press = (e: ReactPointerEvent<HTMLButtonElement>) => {
    // Jak przyciski sterowania dotykowego: reakcja na dotknięcie, bez uruchamiania kamery pod spodem.
    e.stopPropagation();
    e.preventDefault();
    onPress();
  };
  return (
    <button
      type="button"
      data-testid={`hideseek-${action}`}
      aria-label={label}
      onPointerDown={touchUi ? press : undefined}
      onClick={touchUi ? undefined : onPress}
      className={cn(
        "pointer-events-auto absolute flex touch-none select-none items-center justify-center gap-2 rounded-full border-2 border-amber-200 bg-amber-400 font-extrabold text-amber-950 shadow-xl transition-transform active:scale-95",
        touchUi
          ? "min-h-12 max-w-[9rem] px-3 py-1.5 text-center text-[11px] leading-tight"
          : "bottom-36 left-1/2 -translate-x-1/2 px-5 py-2 text-sm",
      )}
      style={touchUi ? { right: "calc(max(0.5rem, var(--sar)) + 7.5rem)", bottom: "calc(max(0.75rem, var(--sab)) + 10.25rem)", WebkitTouchCallout: "none", userSelect: "none", touchAction: "none" } : undefined}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span>{label}</span>
      {!touchUi && <kbd className="rounded bg-amber-950 px-1.5 py-0.5 text-xs text-amber-100">{HIDESEEK_KEY.toUpperCase()}</kbd>}
    </button>
  );
}

function InviteDialog({ open, view, onAnswer }: { open: boolean; view: HsStateView | null; onAnswer: (accept: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent showCloseButton={false} className="pointer-events-auto max-w-sm border-amber-200/40 bg-slate-900 text-center text-white" data-testid="hideseek-invite" initialFocus={preferredInitialFocus}>
        <DialogHeader>
          <DialogTitle className="text-xl font-extrabold text-amber-200">{INVITE.title}</DialogTitle>
          <DialogDescription className="text-base text-slate-100">
            {view?.hostName ? `${view.hostName} zaprasza Cię do wspólnej zabawy w chowanego! Masz ochotę znaleźć najlepszą kryjówkę w naszym lesie?` : INVITE.text}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Button type="button" size="lg" className="h-12 text-base font-bold" data-testid="hideseek-accept" data-gamepad-initial="" onClick={() => onAnswer(true)}>
            {INVITE.accept}
          </Button>
          <Button type="button" size="lg" variant="secondary" className="h-11" data-testid="hideseek-decline" onClick={() => onAnswer(false)}>
            {INVITE.decline}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmDialog({ kind, onYes, onNo }: { kind: "withdraw" | "cancel" | null; onYes: () => void; onNo: () => void }) {
  const text = kind ? CONFIRM[kind] : null;
  return (
    <Dialog open={kind !== null} onOpenChange={(o) => !o && onNo()}>
      <DialogContent showCloseButton={false} className="pointer-events-auto max-w-sm border-white/10 bg-slate-900 text-white" data-testid="hideseek-confirm" initialFocus={preferredInitialFocus}>
        <DialogHeader>
          <DialogTitle>{text?.title}</DialogTitle>
          <DialogDescription className="text-slate-300">{text?.text}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Button type="button" data-testid="hideseek-confirm-no" data-gamepad-initial="" onClick={onNo}>
            {text?.no}
          </Button>
          <Button type="button" variant="secondary" data-testid="hideseek-confirm-yes" onClick={onYes}>
            {text?.yes}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const CONFETTI = ["bg-amber-300", "bg-pink-300", "bg-sky-300", "bg-emerald-300"];

function ResultDialog({ view, onClose }: { view: HsStateView | null; onClose: () => void }) {
  const text = view ? resultText(view) : null;
  const open = !!view && (view.phase === "FINISHED" || view.phase === "CANCELLED") && text !== null;
  const entries = view?.result?.outcomes ?? [];
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent showCloseButton={false} className="pointer-events-auto max-w-md overflow-hidden border-0 bg-transparent p-0 text-center" data-testid="hideseek-result" initialFocus={preferredInitialFocus}>
        {text && (
          <div className={cn("relative rounded-3xl bg-gradient-to-br px-6 py-6 shadow-2xl", TONE[text.tone])}>
            {text.tone === "win" && (
              <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 flex justify-around">
                {Array.from({ length: 10 }, (_, i) => (
                  <span key={i} className={cn("mt-1 size-2 rounded-sm opacity-80 animate-bounce motion-reduce:animate-none", CONFETTI[i % CONFETTI.length])} style={{ animationDelay: `${i * 90}ms`, marginTop: `${(i % 3) * 6 + 4}px` }} />
                ))}
              </div>
            )}
            <DialogHeader className="items-center">
              <p data-testid="hideseek-result-badge" className="rounded-full bg-black/15 px-3 py-0.5 text-xs font-extrabold tracking-widest">
                {text.badge}
              </p>
              <DialogTitle className="mt-2 text-2xl font-extrabold leading-tight sm:text-3xl">{text.title}</DialogTitle>
              <DialogDescription className="text-base font-medium text-inherit/90">{text.text}</DialogDescription>
            </DialogHeader>
            {view?.result && view.result.reason in REASON_LINE && <p className="mt-2 text-xs font-semibold opacity-80">{REASON_LINE[view.result.reason]}</p>}
            {entries.length > 0 && (
              <ul className="mt-3 flex flex-wrap justify-center gap-1.5" aria-label="Wyniki graczy">
                {entries.map((e, i) => (
                  <li key={i} className="rounded-full bg-white/50 px-2.5 py-0.5 text-xs font-semibold">
                    {e.name} · {e.role === "seeker" ? "szukający" : "ukrywający"} · {OUTCOME_BADGE[e.outcome]}
                  </li>
                ))}
              </ul>
            )}
            <Button type="button" size="lg" className="mt-5 h-12 w-full text-base font-extrabold" data-testid="hideseek-result-close" data-gamepad-initial="" onClick={onClose}>
              {ACTIONS.back}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
