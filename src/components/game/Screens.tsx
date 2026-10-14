"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
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
          Wersja demonstracyjna – postęp nie jest zapisywany.
        </p>
      </form>
    </main>
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
