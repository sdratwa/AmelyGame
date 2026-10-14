"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  generateHouse,
  getClock,
  initialState,
  isSheltered,
  reducer,
  type View,
} from "@/lib/game/engine";
import { cn } from "@/lib/utils";
import { ForestView } from "./ForestView";
import { InventoryBar, TopBar } from "./Hud";
import { DeathOverlay, LoadingScreen, NameScreen } from "./Screens";
import { ShopInterior } from "./ShopInterior";
import { WorldMap } from "./WorldMap";

const TICK_MS = 250;

function readSpeed(): number {
  const raw = new URLSearchParams(window.location.search).get("speed");
  const n = raw ? Number(raw) : 1;
  return Number.isFinite(n) && n > 0 && n <= 200 ? n : 1;
}

export function GameApp() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const speed = useRef(1);

  useEffect(() => {
    speed.current = readSpeed();
  }, []);

  useEffect(() => {
    if (state.phase !== "playing") return;
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const dt = Math.min(1, (now - last) / 1000) * speed.current;
      last = now;
      dispatch({ type: "tick", dt });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [state.phase]);

  useEffect(() => {
    if (!state.toast) return;
    const id = state.toast.id;
    const t = setTimeout(() => dispatch({ type: "clearToast", id }), 2800);
    return () => clearTimeout(t);
  }, [state.toast]);

  const onWorldReady = useCallback(() => {
    dispatch({
      type: "worldReady",
      houses: [generateHouse("dom-1"), generateHouse("dom-2")],
    });
  }, []);

  const leave = useCallback(() => dispatch({ type: "leave" }), []);
  const select = useCallback((slot: number) => dispatch({ type: "select", slot }), []);
  const eat = useCallback(() => dispatch({ type: "eat" }), []);
  const enter = useCallback((view: View) => dispatch({ type: "enter", view }), []);

  if (state.phase === "name") {
    return (
      <NameScreen
        initial={state.name}
        onSubmit={(name) => {
          dispatch({ type: "setName", name });
          dispatch({ type: "startLoading" });
        }}
      />
    );
  }

  if (state.phase === "loading") {
    return <LoadingScreen name={state.name} onDone={onWorldReady} />;
  }

  const clock = getClock(state.elapsed);
  const sheltered = isSheltered(state);
  const heldId = state.slots[state.selected];

  return (
    <div className="relative flex h-full flex-col">
      <TopBar state={state} sheltered={sheltered} />
      <main className="relative min-h-0 flex-1">
        {state.view === "world" && (
          <WorldMap
            clock={clock}
            houses={state.houses}
            wallet={state.wallet}
            tutorialDone={state.tutorialDone}
            onEnter={enter}
            onBuyHouse={(id) => dispatch({ type: "buyHouse", id })}
            onUpgradeHouse={(id) => dispatch({ type: "upgradeHouse", id })}
          />
        )}
        {state.view === "shop" && (
          <ShopInterior
            state={state}
            onBuy={(item) => dispatch({ type: "buy", item })}
            onLeave={leave}
          />
        )}
        {state.view === "forest" && (
          <ForestView season={clock.season} isDay={clock.isDay} held={heldId} onLeave={leave} />
        )}

        {state.toast && (
          <div
            key={state.toast.id}
            data-testid="toast"
            role="status"
            className={cn(
              "pointer-events-none absolute inset-x-3 bottom-3 z-30 mx-auto w-fit max-w-full rounded-full px-4 py-2 text-sm font-semibold shadow-xl",
              state.toast.tone === "error"
                ? "bg-red-500 text-white"
                : "bg-emerald-400 text-emerald-950",
            )}
          >
            {state.toast.text}
          </div>
        )}
      </main>
      <InventoryBar state={state} onSelect={select} onEat={eat} />
      {state.dead && <DeathOverlay onRespawn={() => dispatch({ type: "respawn" })} />}
    </div>
  );
}
