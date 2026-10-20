"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  HOUSE_LEVEL_NAME,
  MAX_HOUSE_LEVEL,
  formatMoney,
  formatPhone,
  houseUpgradeCost,
  type ClockInfo,
  type House,
  type HouseLevel,
  type View,
} from "@/lib/game/engine";
import { cn } from "@/lib/utils";
import { preferredInitialFocus } from "@/lib/input/domNavigator";
import { SceneDefs } from "./scene/Defs";
import { HouseDrawing, LEVEL_FRAME } from "./scene/houses";
import { PALETTES } from "./scene/palette";
import { WorldScene } from "./scene/WorldScene";

const PORTRAIT_QUERY = "(orientation: portrait)";

function usePortrait(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(PORTRAIT_QUERY);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(PORTRAIT_QUERY).matches,
    () => false,
  );
}

function LevelPips({ level }: { level: HouseLevel }) {
  return (
    <div className="flex items-center gap-1.5" aria-label={`Poziom ${level} z ${MAX_HOUSE_LEVEL}`}>
      {Array.from({ length: MAX_HOUSE_LEVEL }, (_, i) => (
        <span
          key={i}
          className={cn(
            "h-2.5 w-7 rounded-full",
            i < level ? "bg-amber-300" : "bg-white/15",
          )}
        />
      ))}
    </div>
  );
}

function HouseDialog({
  house,
  wallet,
  season,
  onClose,
  onBuy,
  onUpgrade,
}: {
  house: House | null;
  wallet: number;
  season: ClockInfo["season"];
  onClose: () => void;
  onBuy: (id: string) => void;
  onUpgrade: (id: string) => void;
}) {
  const frame = house ? LEVEL_FRAME[house.level] : null;
  const upgradeCost = house ? houseUpgradeCost(house.level) : null;
  const nextLevel = house && upgradeCost !== null ? ((house.level + 1) as HouseLevel) : null;

  return (
    <Dialog open={!!house} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md border-white/10 bg-slate-900 text-white" data-testid="house-dialog" initialFocus={preferredInitialFocus}>
        {house && frame && (
          <>
            <DialogHeader>
              <DialogTitle>
                {HOUSE_LEVEL_NAME[house.level]} · {house.name}
              </DialogTitle>
              <DialogDescription className="text-slate-400">
                {house.owned
                  ? "To Twój dom. Możesz go ulepszać do poziomu 4."
                  : "Oferta sprzedaży od prywatnego właściciela."}
              </DialogDescription>
            </DialogHeader>

            <div className="overflow-hidden rounded-2xl bg-gradient-to-b from-emerald-900/60 to-emerald-950">
              <svg
                viewBox={`${frame.x} ${frame.y} ${frame.w} ${frame.h}`}
                className="mx-auto h-48 w-full"
                role="img"
                aria-label={HOUSE_LEVEL_NAME[house.level]}
              >
                <SceneDefs palette={PALETTES[season]} />
                <HouseDrawing house={house} season={season} />
              </svg>
            </div>

            <dl className="grid grid-cols-2 items-center gap-x-3 gap-y-2 text-sm">
              <dt className="text-slate-400">Poziom</dt>
              <dd className="flex justify-end">
                <LevelPips level={house.level} />
              </dd>
              {!house.owned && (
                <>
                  <dt className="text-slate-400">Cena</dt>
                  <dd className="text-right font-semibold text-amber-200">{formatMoney(house.price)}</dd>
                  <dt className="text-slate-400">Telefon do właściciela</dt>
                  <dd className="text-right font-mono font-semibold">{formatPhone(house.phone)}</dd>
                </>
              )}
            </dl>

            {!house.owned ? (
              <Button
                data-testid="buy-house"
                disabled={wallet < house.price}
                onClick={() => onBuy(house.id)}
                className="h-11 bg-emerald-500 font-semibold text-emerald-950 hover:bg-emerald-400"
              >
                {wallet < house.price ? "Brak środków" : `Kup za ${formatMoney(house.price)}`}
              </Button>
            ) : nextLevel && upgradeCost !== null ? (
              <Button
                data-testid="upgrade-house"
                disabled={wallet < upgradeCost}
                onClick={() => onUpgrade(house.id)}
                className="h-11 bg-amber-400 font-semibold text-amber-950 hover:bg-amber-300"
              >
                {wallet < upgradeCost
                  ? "Brak środków na ulepszenie"
                  : `Ulepsz do: ${HOUSE_LEVEL_NAME[nextLevel]} · ${formatMoney(upgradeCost)}`}
              </Button>
            ) : (
              <p className="rounded-lg bg-white/5 p-3 text-center text-sm text-amber-200">
                Maksymalny poziom – rezydencja jest w pełni rozbudowana.
              </p>
            )}
            <Button variant="secondary" data-gamepad-initial="" onClick={onClose}>
              Zamknij
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function WorldMap({
  clock,
  houses,
  wallet,
  tutorialDone,
  boardUnread,
  onOpenBoard,
  onEnter,
  onBuyHouse,
  onUpgradeHouse,
}: {
  clock: ClockInfo;
  houses: House[];
  wallet: number;
  tutorialDone: boolean;
  boardUnread: boolean;
  onOpenBoard: () => void;
  onEnter: (view: View) => void;
  onBuyHouse: (id: string) => void;
  onUpgradeHouse: (id: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const portrait = usePortrait();
  const openHouse = houses.find((h) => h.id === openId) ?? null;
  const open = useCallback((house: House) => setOpenId(house.id), []);

  return (
    <section
      data-testid="world-map"
      className="relative h-full w-full overflow-hidden"
      style={{ background: PALETTES[clock.season].edge }}
    >
      <WorldScene
        layoutName={portrait ? "portrait" : "landscape"}
        season={clock.season}
        isDay={clock.isDay}
        houses={houses}
        tutorialDone={tutorialDone}
        boardUnread={boardUnread}
        onEnter={onEnter}
        onOpenHouse={open}
        onOpenBoard={onOpenBoard}
      />

      {!tutorialDone && (
        <div
          data-testid="tutorial-hint"
          className="pointer-events-none absolute inset-x-3 top-3 z-20 mx-auto max-w-md rounded-2xl bg-amber-300 px-4 py-3 text-center text-sm font-semibold text-amber-950 shadow-xl sm:top-5"
        >
          Podejdź do tablicy ogłoszeń (wykrzyknik) i przyjmij zadanie. Dopiero potem ruszysz do lasu.
        </div>
      )}

      <HouseDialog
        house={openHouse}
        wallet={wallet}
        season={clock.season}
        onClose={() => setOpenId(null)}
        onBuy={onBuyHouse}
        onUpgrade={onUpgradeHouse}
      />
    </section>
  );
}
