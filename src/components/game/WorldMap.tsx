"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  formatMoney,
  formatPhone,
  type ClockInfo,
  type House,
  type View,
} from "@/lib/game/engine";
import { cn } from "@/lib/utils";
import { ForestArt, FrogLogo, GROUND, HouseArt, ShopArt } from "./art";

type TileProps = {
  testId: string;
  label: React.ReactNode;
  sub?: React.ReactNode;
  onClick: () => void;
  locked: boolean;
  highlight?: boolean;
  children: React.ReactNode;
};

function Tile({ testId, label, sub, onClick, locked, highlight, children }: TileProps) {
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      disabled={locked}
      aria-label={typeof label === "string" ? label : undefined}
      className={cn(
        "group relative flex min-h-0 flex-col items-stretch gap-1.5 rounded-3xl text-left transition duration-500",
        locked
          ? "pointer-events-none cursor-default opacity-45 grayscale"
          : "cursor-pointer hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white",
        highlight && "z-10",
      )}
    >
      <div
        className={cn(
          "relative aspect-square w-full overflow-hidden rounded-3xl bg-black/5 shadow-lg ring-2 ring-black/10 transition",
          !locked && "group-hover:ring-4 group-hover:ring-white/70",
          highlight && "ring-4 ring-amber-300 shadow-[0_0_40px_6px_rgba(252,211,77,0.6)]",
        )}
      >
        {children}
        {highlight && (
          <>
            <span className="absolute inset-0 animate-pulse rounded-3xl ring-4 ring-amber-200/80" aria-hidden />
            <span
              data-testid="tutorial-exclamation"
              className="absolute right-2 top-2 flex h-9 w-9 animate-bounce items-center justify-center rounded-full bg-amber-400 text-xl font-black text-amber-950 shadow-lg ring-2 ring-white sm:h-12 sm:w-12 sm:text-3xl"
              aria-label="Wymagana akcja"
            >
              !
            </span>
          </>
        )}
      </div>
      <div className="rounded-xl bg-slate-900/85 px-2.5 py-1.5 text-white shadow">
        <div className="text-sm font-semibold leading-tight sm:text-base">{label}</div>
        {sub && <div className="mt-0.5 text-[11px] leading-snug text-slate-300 sm:text-xs">{sub}</div>}
      </div>
    </button>
  );
}

export function WorldMap({
  clock,
  houses,
  tutorialDone,
  onEnter,
}: {
  clock: ClockInfo;
  houses: House[];
  tutorialDone: boolean;
  onEnter: (view: View) => void;
}) {
  const [openHouse, setOpenHouse] = useState<House | null>(null);
  const ground = GROUND[clock.season];
  const locked = !tutorialDone;

  return (
    <section
      data-testid="world-map"
      className="relative flex h-full w-full items-center justify-center overflow-y-auto p-3 sm:p-6"
      style={{
        background: `radial-gradient(circle at 30% 20%, ${ground.accent}, ${ground.base} 70%)`,
      }}
    >
      <div className="pointer-events-none absolute inset-0 opacity-30" aria-hidden>
        <div className="absolute left-0 right-0 top-1/2 h-10 -translate-y-1/2 bg-slate-500" />
        <div className="absolute bottom-0 top-0 left-1/2 w-10 -translate-x-1/2 bg-slate-500" />
      </div>

      <div className="relative z-10 my-auto grid w-full max-w-[min(100%,34rem)] grid-cols-2 gap-3 sm:gap-6 lg:max-w-[min(100%,calc((100dvh-16rem)*1.15))]">
        <Tile
          testId="tile-forest"
          label="Las"
          sub="Idź na spacer"
          locked={false}
          highlight={locked}
          onClick={() => onEnter("forest")}
        >
          <ForestArt season={clock.season} />
        </Tile>
        <Tile
          testId="tile-shop"
          label={
            <span className="flex items-center gap-1.5">
              <FrogLogo size={20} /> Żappka
            </span>
          }
          sub="Jedzenie i schronienie"
          locked={locked}
          onClick={() => onEnter("shop")}
        >
          <ShopArt season={clock.season} />
        </Tile>
        {houses.map((house, i) => (
          <Tile
            key={house.id}
            testId={`tile-house-${i}`}
            label={`Dom na sprzedaż`}
            sub={
              <>
                <span className="font-semibold text-amber-200">{formatMoney(house.price)}</span>
                <span className="block">tel. {formatPhone(house.phone)}</span>
              </>
            }
            locked={locked}
            onClick={() => setOpenHouse(house)}
          >
            <HouseArt house={house} season={clock.season} />
          </Tile>
        ))}
      </div>

      {locked && (
        <div
          data-testid="tutorial-hint"
          className="pointer-events-none absolute inset-x-3 top-3 z-20 mx-auto max-w-md rounded-2xl bg-amber-300 px-4 py-3 text-center text-sm font-semibold text-amber-950 shadow-xl sm:top-5"
        >
          Zacznij od lasu – kliknij podświetlone drzewa.
        </div>
      )}

      <div
        className={cn(
          "pointer-events-none absolute inset-0 z-[5] bg-[#0a1235] transition-opacity duration-1000",
          clock.isDay ? "opacity-0" : "opacity-45",
        )}
        aria-hidden
      />

      <Dialog open={!!openHouse} onOpenChange={(o) => !o && setOpenHouse(null)}>
        <DialogContent className="max-w-sm border-white/10 bg-slate-900 text-white" data-testid="house-dialog">
          {openHouse && (
            <>
              <DialogHeader>
                <DialogTitle>{openHouse.name}</DialogTitle>
                <DialogDescription className="text-slate-400">
                  Oferta sprzedaży od prywatnego właściciela.
                </DialogDescription>
              </DialogHeader>
              <div className="mx-auto aspect-square w-40 overflow-hidden rounded-2xl">
                <HouseArt house={openHouse} season={clock.season} />
              </div>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt className="text-slate-400">Cena</dt>
                <dd className="text-right font-semibold text-amber-200">{formatMoney(openHouse.price)}</dd>
                <dt className="text-slate-400">Telefon do właściciela</dt>
                <dd className="text-right font-mono font-semibold">{formatPhone(openHouse.phone)}</dd>
              </dl>
              <p className="rounded-lg bg-white/5 p-3 text-xs text-slate-400">
                Kupno i zwiedzanie domów pojawi się w kolejnej wersji gry.
              </p>
              <Button variant="secondary" onClick={() => setOpenHouse(null)}>
                Zamknij
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
