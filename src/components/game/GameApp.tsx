"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  boardEntries,
  boardHasUnread,
  getClock,
  initialState,
  journalEntries,
  INVENTORY_SLOTS,
  isSheltered,
  ITEMS,
  reducer,
  trackedQuest,
  type ForestPose,
  type QuestId,
  type View,
} from "@/lib/game/engine";
import { Autosaver } from "@/lib/game/save/autosave";
import { loadGame, type BootResult } from "@/lib/game/save/loader";
import { createNewGameParams } from "@/lib/game/save/newGame";
import { LocalStorageSaveStore, type SaveStore } from "@/lib/game/save/store";
import { cn } from "@/lib/utils";
import type { QualityId } from "@/lib/assets";

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
import { BlueprintDialog } from "./BlueprintDialog";
import { InventoryPanel } from "./InventoryPanel";
import { JournalPanel, type SaveStatus } from "./quest/JournalPanel";
import { QuestBoardDialog } from "./quest/QuestBoardDialog";
import { QuestTracker } from "./quest/QuestTracker";
import { useGamePause } from "./quest/useGamePause";
import { ShopInterior } from "./ShopInterior";
import { WorldMap } from "./WorldMap";
import { isGameLetterShortcut } from "@/lib/input/shortcuts";
import { setFreeForest, startBrowserInput } from "@/lib/input/browser";
import { useInputActions } from "@/components/input/hooks";
import { PauseMenu } from "./PauseMenu";
import { ControllerSettingsDialog } from "./ControllerSettingsDialog";

type Panel = "board" | "journal" | "inventory" | "blueprint" | "pause" | "settings";

const ForestWorldView = dynamic(() => import("./ForestWorldView").then((m) => m.ForestWorldView), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-slate-950 text-slate-300">Wchodzisz do lasu…</div>
  ),
});

const TICK_MS = 250;
const QUALITY_KEY = "miasto.forest.quality";

function readQuality(): QualityId {
  try {
    const v = window.localStorage.getItem(QUALITY_KEY);
    return v === "LOW" || v === "HIGH" || v === "MEDIUM" ? v : "MEDIUM";
  } catch {
    return "MEDIUM";
  }
}

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
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [forestLoading, setForestLoading] = useState(false);
  const [forestQuality, setForestQuality] = useState<QualityId>(readQuality);
  const [panel, setPanel] = useState<Panel | null>(null);

  // Wejście (pad, wykrywanie urządzenia, nawigacja po interfejsie): jeden nasłuch na całą aplikację.
  useEffect(() => startBrowserInput(), []);

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
      onResult: (outcome) => {
        setSaveError(outcome.ok ? null : outcome.error);
        if (outcome.ok) setLastSavedAt(Date.now());
      },
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

  // Kamienie milowe (zbudowany most, odkryty obszar, ukończone zadanie) zapisują się od razu, bez czekania na debounce.
  const milestones = `${state.bridge.built ? 1 : 0}|${state.discovered.length}|${Object.keys(state.quests.completed).length}`;
  useEffect(() => {
    if (!enabledAutosave) return;
    autosaverRef.current?.flush();
  }, [milestones, enabledAutosave]);

  const saveNow = useCallback(async () => {
    const autosaver = autosaverRef.current;
    if (!autosaver) return;
    setSaving(true);
    const outcome = await autosaver.saveNow();
    setSaving(false);
    setSaveError(outcome.ok ? null : outcome.error);
    if (outcome.ok) setLastSavedAt(Date.now());
  }, []);

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

  const playing = state.phase === "playing" && !state.dead;
  const canOpenPanel = playing && !state.dialog && state.view !== "forest";
  const boardOpen = panel === "board" && canOpenPanel;
  const journalOpen = panel === "journal" && playing && !state.dialog;
  useGamePause(dispatch, "ui.panel", "ui.board", boardOpen);
  useGamePause(dispatch, "ui.panel", "ui.journal", journalOpen);
  const inventoryOpen = panel === "inventory" && playing && !state.dialog;
  useGamePause(dispatch, "ui.panel", "ui.inventory", inventoryOpen);
  const blueprintOpen = panel === "blueprint" && playing && !state.dialog;
  useGamePause(dispatch, "ui.panel", "ui.blueprint", blueprintOpen);
  const pauseOpen = panel === "pause" && playing && !state.dialog;
  const settingsOpen = panel === "settings" && playing && !state.dialog;
  useGamePause(dispatch, "ui.panel", "ui.pause_menu", pauseOpen || settingsOpen);
  // Zdobycie schematu (komunikat z silnika) otwiera okno z wymaganymi materiałami; id komunikatu jest unikalne,
  // więc wczytanie zapisu nie otwiera okna ponownie.
  const toastId = state.toast?.id ?? null;
  const toastText = state.toast?.text ?? null;
  const blueprintToast = toastId !== null && toastText === ITEMS["item.bridge_blueprint"].pickupMessage;
  // Otwarcie okna to dostosowanie stanu podczas renderu (bez setState w efekcie); każdy komunikat obsługujemy raz.
  const [handledBlueprintToast, setHandledBlueprintToast] = useState<typeof toastId>(null);
  if (blueprintToast && handledBlueprintToast !== toastId) {
    setHandledBlueprintToast(toastId);
    setPanel("blueprint");
  }
  useEffect(() => {
    if (blueprintToast) document.exitPointerLock?.();
  }, [blueprintToast, toastId]);
  useGamePause(dispatch, "ui.forest", "ui.forest_loading", state.view === "forest" && forestLoading);

  const changeForestQuality = useCallback((quality: QualityId) => {
    setForestQuality(quality);
    try {
      window.localStorage.setItem(QUALITY_KEY, quality);
    } catch {
      // zapis ustawienia jakości nie jest krytyczny
    }
  }, []);

  /** Przełączanie paneli (J, I, menu): jedna ścieżka dla klawiatury i pada. */
  const togglePanel = useCallback((which: "journal" | "inventory" | "pause") => {
    setPanel((cur) => {
      if (cur === which) return null;
      if (which === "pause" && cur === "settings") return null;
      if (cur !== null) return cur;
      if (document.querySelector('[data-slot="dialog-content"]')) return cur;
      document.exitPointerLock?.();
      return which;
    });
  }, []);

  useEffect(() => {
    if (!playing) return;
    const onKey = (e: KeyboardEvent) => {
      const which = isGameLetterShortcut(e, "j") ? "journal" : isGameLetterShortcut(e, "i") ? "inventory" : null;
      if (which) togglePanel(which);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playing, togglePanel]);

  // Pad: te same panele i ten sam pasek ekwipunku co klawiatura (Y/△ ekwipunek, X/□ dziennik, OPTIONS menu, R1/R2 sloty).
  useInputActions((e) => {
    if (e.source !== "gamepad" || !playing) return false;
    switch (e.action) {
      case "inventory":
        togglePanel("inventory");
        return true;
      case "journal":
        togglePanel("journal");
        return true;
      case "pause":
        if (!state.dialog) togglePanel("pause");
        return true;
      case "slotPrev":
      case "slotNext": {
        if (state.view !== "forest" || panel !== null || state.dialog) return true;
        const delta = e.action === "slotNext" ? 1 : -1;
        dispatch({ type: "select", slot: (state.selected + delta + INVENTORY_SLOTS) % INVENTORY_SLOTS });
        return true;
      }
      default:
        return false;
    }
  });

  // Gracz steruje wolnym lasem (bez okien i menu): wtedy D-pad zmienia slot, a nie nawiguje po interfejsie.
  const freeForest = playing && state.view === "forest" && panel === null && !state.dialog;
  useEffect(() => {
    setFreeForest(freeForest);
    return () => setFreeForest(false);
  }, [freeForest]);

  const closePanel = useCallback(() => setPanel(null), []);
  const openBoard = useCallback(() => setPanel("board"), []);
  const openJournal = useCallback(() => {
    document.exitPointerLock?.();
    setPanel("journal");
  }, []);
  const openMenu = () => {
    if (!playing || state.dialog) return;
    document.exitPointerLock?.();
    setPanel((cur) => (cur === null ? "pause" : cur));
  };
  const readBoard = useCallback((id: QuestId) => dispatch({ type: "board.read", id }), []);
  const acceptQuest = useCallback((id: QuestId) => dispatch({ type: "quest.accept", id }), []);

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

  const saveStatus: SaveStatus = saving
    ? { kind: "saving" }
    : saveError
      ? { kind: "error", error: saveError }
      : { kind: "idle", lastAt: lastSavedAt };
  const clock = getClock(state.elapsed);
  const sheltered = isSheltered(state);

  return (
    <div className="relative flex h-full flex-col">
      <TopBar state={state} sheltered={sheltered} onOpenJournal={openJournal} onOpenMenu={openMenu} />
      <main className="relative min-h-0 flex-1">
        {state.view === "world" && (
          <WorldMap
            clock={clock}
            houses={state.houses}
            wallet={state.wallet}
            tutorialDone={state.tutorialDone}
            boardUnread={boardHasUnread(state)}
            onOpenBoard={openBoard}
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
        {state.view === "forest" && state.world && (
          <ForestWorldView
            seed={state.world.seed}
            gameState={state}
            dispatch={dispatch}
            startPose={state.forestPose}
            bridgeBuilt={state.bridge.built}
            hour={clock.hour + clock.minute / 60}
            quality={forestQuality}
            onQualityChange={changeForestQuality}
            suspended={panel !== null || !!state.dialog || state.dead}
            onPose={onPose}
            onLeave={leave}
            onLoadingChange={setForestLoading}
          />
        )}

        {state.view !== "shop" && <QuestTracker quest={trackedQuest(state)} />}

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
      <QuestBoardDialog
        open={boardOpen}
        quests={boardEntries(state)}
        onClose={closePanel}
        onRead={readBoard}
        onAccept={acceptQuest}
      />
      <JournalPanel
        open={journalOpen}
        {...journalEntries(state)}
        badges={state.badges}
        saveStatus={saveStatus}
        onSave={saveNow}
        onClose={closePanel}
      />
      <InventoryPanel open={inventoryOpen} state={state} onClose={closePanel} onReadBlueprint={() => setPanel("blueprint")} />
      <BlueprintDialog open={blueprintOpen} state={state} onClose={closePanel} />
      <PauseMenu
        open={pauseOpen}
        view={state.view}
        onResume={closePanel}
        onSettings={() => setPanel("settings")}
        onSave={saveNow}
        onLeave={() => {
          setPanel(null);
          leave();
        }}
      />
      <ControllerSettingsDialog open={settingsOpen} onClose={() => setPanel("pause")} />
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
