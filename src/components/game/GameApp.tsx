"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  getClock,
  initialState,
  isSheltered,
  reducer,
  type ForestPose,
  type View,
} from "@/lib/game/engine";
import { Autosaver } from "@/lib/game/save/autosave";
import { loadGame, type BootResult } from "@/lib/game/save/loader";
import { createNewGameParams } from "@/lib/game/save/newGame";
import { LocalStorageSaveStore, type SaveStore } from "@/lib/game/save/store";
import { cn } from "@/lib/utils";
import { ForestView } from "./ForestView";
import { InventoryBar, TopBar } from "./Hud";
import {
  BootScreen,
  ContinueScreen,
  DeathOverlay,
  LoadingScreen,
  NameScreen,
  SaveProblemScreen,
  type SaveProblem,
} from "./Screens";
import { ShopInterior } from "./ShopInterior";
import { WorldMap } from "./WorldMap";

const TICK_MS = 250;

function readSpeed(): number {
  const raw = new URLSearchParams(window.location.search).get("speed");
  const n = raw ? Number(raw) : 1;
  return Number.isFinite(n) && n > 0 && n <= 200 ? n : 1;
}

function toProblem(result: BootResult): SaveProblem | null {
  switch (result.kind) {
    case "corrupt":
      return { kind: "corrupt", problems: result.problems };
    case "unsupported":
      return { kind: "unsupported", version: result.version };
    case "migration_failed":
      return { kind: "migration_failed", error: result.error };
    case "world_mismatch":
      return { kind: "world_mismatch", reason: result.reason };
    default:
      return null;
  }
}

type Boot = { status: "loading" } | { status: "ready"; result: BootResult };

function DevResetButton({ onReset }: { onReset: () => void }) {
  if (process.env.NODE_ENV === "production") return null;
  return (
    <button
      type="button"
      data-testid="dev-reset-save"
      onClick={onReset}
      className="fixed bottom-1 right-1 z-50 rounded bg-black/40 px-2 py-0.5 text-[10px] text-white/50 hover:text-white"
    >
      dev: reset zapisu
    </button>
  );
}

export function GameApp() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const speed = useRef(1);
  const storeRef = useRef<SaveStore | null>(null);
  const autosaverRef = useRef<Autosaver | null>(null);
  const [boot, setBoot] = useState<Boot>({ status: "loading" });
  const [bootNonce, setBootNonce] = useState(0);
  const [wantsNewGame, setWantsNewGame] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const getStore = useCallback((): SaveStore => {
    storeRef.current ??= new LocalStorageSaveStore();
    return storeRef.current;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const store = getStore();
    const run = async () => {
      const url = new URL(window.location.href);
      if (url.searchParams.get("reset") === "1") {
        await store.reset();
        url.searchParams.delete("reset");
        window.history.replaceState(null, "", url.toString());
      }
      return loadGame(store);
    };
    run()
      .then((result) => !cancelled && setBoot({ status: "ready", result }))
      .catch(() => {
        if (cancelled) return;
        setSaveError("Zapis gry jest niedostępny w tej przeglądarce.");
        setBoot({ status: "ready", result: { kind: "none" } });
      });
    return () => {
      cancelled = true;
    };
  }, [bootNonce, getStore]);

  const enabledAutosave = state.phase === "playing";
  const loadedSave =
    boot.status === "ready" && boot.result.kind === "ok" ? boot.result.save : undefined;

  useEffect(() => {
    if (!enabledAutosave) return;
    const initial = loadedSave;
    const autosaver = new Autosaver({
      store: getStore(),
      now: () => Date.now(),
      initial,
      onResult: (outcome) => setSaveError(outcome.ok ? null : outcome.error),
    });
    autosaverRef.current = autosaver;
    const flush = () => autosaver.flush();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      autosaver.flush();
      autosaver.dispose();
      autosaverRef.current = null;
    };
  }, [enabledAutosave, loadedSave, getStore]);

  useEffect(() => {
    autosaverRef.current?.update(state);
  }, [state, enabledAutosave]);

  const resetSave = useCallback(async () => {
    autosaverRef.current?.dispose();
    await getStore().reset();
    window.location.reload();
  }, [getStore]);

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

  const onWorldReady = useCallback(() => dispatch({ type: "worldReady" }), []);
  const onPose = useCallback((pose: ForestPose) => dispatch({ type: "forest.pose", pose }), []);

  const leave = useCallback(() => dispatch({ type: "leave" }), []);
  const select = useCallback((slot: number) => dispatch({ type: "select", slot }), []);
  const eat = useCallback(() => dispatch({ type: "eat" }), []);
  const enter = useCallback((view: View) => dispatch({ type: "enter", view }), []);

  const devReset = <DevResetButton onReset={resetSave} />;

  if (state.phase === "name") {
    if (boot.status === "loading") return <BootScreen />;
    const result = boot.result;
    const retry = () => {
      setBoot({ status: "loading" });
      setBootNonce((n) => n + 1);
    };
    const newGame = () => setWantsNewGame(true);
    if (!wantsNewGame && result.kind === "ok") {
      return (
        <>
          <ContinueScreen
            save={result.save}
            notice={
              result.source === "backup"
                ? "Główny zapis był uszkodzony – wczytano kopię zapasową."
                : result.migratedFrom !== undefined
                  ? "Zapis został zaktualizowany do nowego formatu (kopia oryginału zachowana)."
                  : undefined
            }
            onContinue={() => dispatch({ type: "game.load", save: result.save })}
            onNewGame={newGame}
          />
          {devReset}
        </>
      );
    }
    const problem = wantsNewGame ? null : toProblem(result);
    if (problem) {
      return (
        <>
          <SaveProblemScreen problem={problem} onNewGame={newGame} onRetry={retry} />
          {devReset}
        </>
      );
    }
    return (
      <>
        <NameScreen
          initial={state.name}
          onSubmit={(name) => {
            const { seed, saveId } = createNewGameParams();
            dispatch({ type: "setName", name });
            dispatch({ type: "startLoading", seed, saveId });
          }}
        />
        {devReset}
      </>
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
          <ForestView
            season={clock.season}
            isDay={clock.isDay}
            held={heldId}
            startPose={state.forestPose}
            onPose={onPose}
            onLeave={leave}
          />
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
      {saveError && (
        <p
          role="alert"
          data-testid="save-error"
          className="pointer-events-none absolute bottom-16 left-3 z-40 max-w-xs rounded-lg bg-red-600/90 px-3 py-1.5 text-xs text-white shadow-lg"
        >
          Nie udało się zapisać gry: {saveError}
        </p>
      )}
      {devReset}
    </div>
  );
}
