"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatMoney, getClock } from "@/lib/game/engine";
import type { SaveV1 } from "@/lib/game/save/schema";
import { FrogLogo } from "./art";

export function NameScreen({
  initial,
  onSubmit,
}: {
  initial: string;
  onSubmit: (name: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const [touched, setTouched] = useState(false);
  const name = value.trim();
  const error = touched && !name ? "Podaj imię, żebyśmy wiedzieli, jak się do Ciebie zwracać." : null;

  return (
    <main className="relative flex h-full items-center justify-center overflow-y-auto bg-[radial-gradient(ellipse_at_top,#1e3a5f_0%,#0b1220_65%)] p-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (name) onSubmit(name);
        }}
        className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-900/80 p-6 shadow-2xl backdrop-blur sm:p-8"
      >
        <div className="mb-6 text-center">
          <div className="mb-3 text-5xl" aria-hidden>
            🏙️
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Gra Miasto</h1>
          <p className="mt-2 text-sm text-slate-300">
            Jest zima 2030. Masz telefon, milion złotych i trochę czasu, zanim
            zimno zacznie dawać się we znaki. Jak masz na imię?
          </p>
        </div>
        <label htmlFor="player-name" className="mb-1.5 block text-sm font-medium text-slate-200">
          Twoje imię
        </label>
        <input
          id="player-name"
          data-testid="name-input"
          autoFocus
          autoComplete="given-name"
          maxLength={20}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={error ? "name-error" : undefined}
          placeholder="np. Ola"
          className="h-12 w-full rounded-xl border border-slate-600 bg-slate-800 px-4 text-lg text-white outline-none placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
        />
        <p id="name-error" className="mt-1.5 h-5 text-sm text-red-400" role="alert">
          {error}
        </p>
        <Button
          type="submit"
          data-testid="start-button"
          size="lg"
          className="mt-3 h-12 w-full bg-emerald-500 text-base font-semibold text-emerald-950 hover:bg-emerald-400"
        >
          Zaczynam przygodę
        </Button>
        <p className="mt-4 text-center text-xs text-slate-500">
          Postęp zapisuje się automatycznie w tej przeglądarce.
        </p>
      </form>
    </main>
  );
}

const SEASON_NAME = { winter: "zima", spring: "wiosna", summer: "lato", autumn: "jesień" } as const;

function ScreenShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex h-full items-center justify-center overflow-y-auto bg-[radial-gradient(ellipse_at_top,#1e3a5f_0%,#0b1220_65%)] p-4">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-900/80 p-6 shadow-2xl backdrop-blur sm:p-8">
        {children}
      </div>
    </main>
  );
}

export function BootScreen() {
  return (
    <main
      data-testid="boot-screen"
      className="flex h-full items-center justify-center bg-[radial-gradient(ellipse_at_top,#1e3a5f_0%,#0b1220_65%)] text-slate-300"
    >
      Wczytuję zapis…
    </main>
  );
}

export function ContinueScreen({
  save,
  notice,
  onContinue,
  onNewGame,
}: {
  save: SaveV1;
  notice?: string;
  onContinue: () => void;
  onNewGame: () => void;
}) {
  const clock = getClock(save.time.elapsed);
  return (
    <ScreenShell>
      <div className="mb-5 text-center">
        <div className="mb-3 text-5xl" aria-hidden>
          🏙️
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Gra Miasto</h1>
        <p className="mt-2 text-sm text-slate-300">Znaleźliśmy zapisaną grę w tej przeglądarce.</p>
      </div>
      {notice && (
        <p role="status" data-testid="save-notice" className="mb-4 rounded-xl bg-amber-500/15 px-3 py-2 text-sm text-amber-200">
          {notice}
        </p>
      )}
      <dl data-testid="save-summary" className="mb-5 grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl bg-slate-800/70 p-4 text-sm">
        <dt className="text-slate-400">Gracz</dt>
        <dd className="text-right font-semibold">{save.player.name}</dd>
        <dt className="text-slate-400">Dzień</dt>
        <dd className="text-right">
          {clock.day + 1}, {SEASON_NAME[clock.season]}
        </dd>
        <dt className="text-slate-400">Portfel</dt>
        <dd className="text-right tabular-nums">{formatMoney(save.player.wallet)}</dd>
        <dt className="text-slate-400">Domy</dt>
        <dd className="text-right">{save.houses.filter((h) => h.owned).length}</dd>
      </dl>
      <Button
        autoFocus
        data-testid="continue-button"
        size="lg"
        onClick={onContinue}
        className="h-12 w-full bg-emerald-500 text-base font-semibold text-emerald-950 hover:bg-emerald-400"
      >
        Kontynuuj
      </Button>
      <Button
        data-testid="new-game-button"
        variant="secondary"
        size="lg"
        onClick={onNewGame}
        className="mt-3 h-12 w-full text-base"
      >
        Nowa gra
      </Button>
      <p className="mt-3 text-center text-xs text-slate-500">
        Rozpoczęcie nowej gry zachowuje poprzedni zapis w kopii archiwalnej.
      </p>
    </ScreenShell>
  );
}

export type SaveProblem =
  | { kind: "corrupt"; problems: string[] }
  | { kind: "unsupported"; version: number }
  | { kind: "migration_failed"; error: string }
  | { kind: "world_mismatch"; reason: string };

const PROBLEM_COPY: Record<SaveProblem["kind"], { title: string; text: string }> = {
  corrupt: {
    title: "Zapis jest uszkodzony",
    text: "Nie udało się odczytać ani zapisu głównego, ani kopii zapasowej. Uszkodzone dane zostały zachowane w pamięci przeglądarki do ewentualnego odzysku.",
  },
  unsupported: {
    title: "Zapis pochodzi z nowszej wersji gry",
    text: "Ta wersja gry nie potrafi go bezpiecznie odczytać, więc nie zostanie ruszony ani nadpisany. Odśwież stronę po aktualizacji.",
  },
  migration_failed: {
    title: "Nie udało się zaktualizować zapisu",
    text: "Oryginalny zapis pozostał nietknięty, a jego kopia zapasowa została zachowana.",
  },
  world_mismatch: {
    title: "Zapis nie pasuje do świata gry",
    text: "Zapisany świat różni się od tego, który generuje ta wersja gry. Dane pozostały nietknięte.",
  },
};

export function SaveProblemScreen({
  problem,
  onNewGame,
  onRetry,
}: {
  problem: SaveProblem;
  onNewGame: () => void;
  onRetry: () => void;
}) {
  const copy = PROBLEM_COPY[problem.kind];
  const detail =
    problem.kind === "corrupt"
      ? problem.problems.join(" • ")
      : problem.kind === "migration_failed"
        ? problem.error
        : problem.kind === "world_mismatch"
          ? problem.reason
          : `wersja zapisu: ${problem.version}`;
  return (
    <ScreenShell>
      <div className="mb-4 text-center">
        <div className="mb-3 text-5xl" aria-hidden>
          ⚠️
        </div>
        <h1 data-testid="save-problem-title" className="text-2xl font-bold">
          {copy.title}
        </h1>
        <p className="mt-2 text-sm text-slate-300">{copy.text}</p>
      </div>
      <p className="mb-5 max-h-24 overflow-y-auto rounded-xl bg-slate-800/70 p-3 text-xs text-slate-400">{detail}</p>
      <Button
        variant="secondary"
        size="lg"
        onClick={onRetry}
        data-testid="retry-button"
        className="h-12 w-full text-base"
      >
        Spróbuj ponownie
      </Button>
      {problem.kind !== "unsupported" && (
        <Button
          data-testid="new-game-button"
          size="lg"
          onClick={onNewGame}
          className="mt-3 h-12 w-full bg-emerald-500 text-base font-semibold text-emerald-950 hover:bg-emerald-400"
        >
          Zacznij nową grę
        </Button>
      )}
      {problem.kind !== "unsupported" && (
        <p className="mt-3 text-center text-xs text-slate-500">Stare dane zostaną zachowane w kopii archiwalnej.</p>
      )}
    </ScreenShell>
  );
}

const TIPS = [
  "Zimą w dzień życie spada o 1% co 10 s, a w nocy aż co 5 s.",
  "W sklepie Żappka możesz się schronić przed zimnem.",
  "Jedzenie z ekwipunku leczy – zaznacz je i naciśnij E.",
  "Telefon zawsze zostaje z Tobą, nawet po śmierci.",
];

export function LoadingScreen({
  name,
  duration = 2600,
  onDone,
}: {
  name: string;
  duration?: number;
  onDone: () => void;
}) {
  const [progress, setProgress] = useState(0);
  const [tip] = useState(() => TIPS[Math.floor(Math.random() * TIPS.length)]);

  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    let done = false;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      setProgress(p);
      if (p >= 1) {
        if (!done) {
          done = true;
          onDone();
        }
        return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [duration, onDone]);

  const label =
    progress < 0.35 ? "Układamy ulice…" : progress < 0.7 ? "Sadzimy drzewa…" : "Wystawiamy domy na sprzedaż…";

  return (
    <main
      data-testid="loading-screen"
      className="flex h-full flex-col items-center justify-center gap-6 bg-[radial-gradient(ellipse_at_top,#1e3a5f_0%,#0b1220_65%)] p-6 text-center"
    >
      <div className="animate-bounce" aria-hidden>
        <FrogLogo size={72} />
      </div>
      <div>
        <h2 className="text-2xl font-bold">Witaj, {name}!</h2>
        <p className="mt-1 text-slate-300">Ładujemy świat gry…</p>
      </div>
      <div className="w-full max-w-sm">
        <div
          className="h-3 overflow-hidden rounded-full bg-slate-700"
          role="progressbar"
          aria-label="Ładowanie świata"
          aria-valuenow={Math.round(progress * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-full rounded-full bg-emerald-400" style={{ width: `${progress * 100}%` }} />
        </div>
        <div className="mt-2 flex justify-between text-xs text-slate-400">
          <span>{label}</span>
          <span className="tabular-nums">{Math.round(progress * 100)}%</span>
        </div>
      </div>
      <p className="max-w-sm text-sm text-slate-400">Wskazówka: {tip}</p>
    </main>
  );
}

export function DeathOverlay({ onRespawn }: { onRespawn: () => void }) {
  return (
    <div
      data-testid="death-overlay"
      role="alertdialog"
      aria-labelledby="death-title"
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-sm rounded-3xl border border-red-500/30 bg-slate-900 p-6 text-center shadow-2xl">
        <div className="text-5xl" aria-hidden>
          💀
        </div>
        <h2 id="death-title" className="mt-3 text-2xl font-bold text-red-400">
          Nie przetrwałeś
        </h2>
        <p className="mt-2 text-sm text-slate-300">
          Życie spadło do zera. Odrodzisz się na mapie świata z pełnym zdrowiem
          i telefonem – pozostałe przedmioty przepadną.
        </p>
        <Button
          autoFocus
          data-testid="respawn-button"
          size="lg"
          onClick={onRespawn}
          className="mt-5 h-12 w-full bg-red-500 text-base font-semibold text-white hover:bg-red-400"
        >
          Odrodź się
        </Button>
      </div>
    </div>
  );
}
