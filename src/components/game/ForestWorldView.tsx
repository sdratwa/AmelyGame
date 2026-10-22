"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ForestRenderer, type PanelStats } from "@/lib/forest-view";
import type { QualityId } from "@/lib/assets";
import { ITEMS, type Command, type ForestPose, type GameState } from "@/lib/game/engine";
import { applyCommand } from "@/lib/game/core/apply";
import { ForestInteractor, type InteractorSnapshot } from "@/lib/game/systems/interactor";
import { dispatchWithReactions } from "@/lib/game/systems/npcReactions";
import { forestObject } from "@/lib/game/world/lookup";
import { harvestOf } from "@/lib/game/world/harvest";
import { safeForestPose } from "@/lib/game/world/generators/v2";
import { resolveTppConfig } from "@/lib/tpp/storedDefaults";
import { cn } from "@/lib/utils";
import { FOREST_CONTROLS, isDiagnosticsShortcut, isGameLetterShortcut } from "@/lib/input/shortcuts";
import { getInputHub, rumble } from "@/lib/input/browser";
import { preferredInitialFocus } from "@/lib/input/domNavigator";
import { padForestHelp } from "@/lib/input/prompts";
import { InputHint } from "@/components/input/InputHint";
import { useInputActions, useInputDevice } from "@/components/input/hooks";
import { nearestCreature } from "@/lib/forest-view/diagnostics";
import { getForestAudio } from "@/lib/audio/controller";
import { nextClockTime } from "@/lib/game/systems/devClock";
import { AudioControls } from "./AudioControls";
import { AudioDiagnostics, type AudioSnapshot } from "./AudioDiagnostics";
import { useForestAudio } from "./useForestAudio";
import { TrollTestDialog } from "./TrollTestDialog";
import { TrollDialog } from "./TrollDialog";
import { BridgeBuildDialog } from "./BridgeBuildDialog";
import { TrollMaterialDiagnostics } from "./TrollMaterialDiagnostics";
import { AppearanceControls } from "@/components/character/AppearanceControls";
import type { AppearanceStats } from "@/lib/forest-view";
import type { CharacterAppearanceV1 } from "@/lib/character";
import { Minimap } from "./Minimap";
import { useGamePause } from "./quest/useGamePause";
import type { DialogOutcome } from "@/lib/npc/encounter";
import type { TrollMaterialMode } from "@/lib/npc/trollMaterials";

const MINIMAP_KEY = "miasto.forest.minimap";
const POLL_MS = 100;
const NO_INTERACTION: InteractorSnapshot = { target: null, prompt: null, window: null, opening: null, buildWindow: false };

function readMinimap(): boolean {
  try {
    return window.localStorage.getItem(MINIMAP_KEY) !== "off";
  } catch {
    return true;
  }
}

const POSE_REPORT_MS = 2000;
/** Esc zwalnia mysz (przeglądarka), a dopiero kolejne Esc opuszcza las; ta zwłoka chroni przed przypadkowym wyjściem. */
const ESC_GUARD_MS = 700;

export const QUALITY_LABEL: Record<QualityId, string> = { LOW: "Niska", MEDIUM: "Średnia", HIGH: "Wysoka" };
const QUALITIES: readonly QualityId[] = ["LOW", "MEDIUM", "HIGH"];

export type ForestWorldViewProps = {
  seed: number;
  /** Stan gry (źródło prawdy): skrzynie, ekwipunek, zebrane obiekty i zadania; widok niczego nie przechowuje sam. */
  gameState: GameState;
  dispatch: (command: Command) => void;
  /** Zapisana pozycja; niepoprawna (np. wewnątrz drzewa) zostanie zastąpiona punktem wejścia. */
  startPose: ForestPose | null;
  bridgeBuilt: boolean;
  /** Godzina z zegara gry (ułamkowa, 0-24). */
  hour: number;
  quality: QualityId;
  onQualityChange: (quality: QualityId) => void;
  /** Panel (dziennik, dialog) zawiesza sterowanie. */
  suspended: boolean;
  onPose: (pose: ForestPose) => void;
  onLeave: () => void;
  onLoadingChange: (loading: boolean) => void;
};

const DEER_MODE_LABEL: Record<string, string> = { rest: "odpoczywa", stroll: "spaceruje", alert: "czujny (patrzy na gracza)", retreat: "odchodzi" };

function DiagnosticsPanel({
  stats,
  audio,
  onRestartEncounter,
  onSetHour,
  onTestWolves,
  onSetTrollMaterial,
  onPreviewSteps,
  onSetStepVolume,
  onToggleLampMarkers,
  appearance,
  appearanceStats,
  onChangeAppearance,
}: {
  stats: PanelStats;
  audio: AudioSnapshot | null;
  onRestartEncounter: () => void;
  onSetHour: (hour: number) => void;
  onTestWolves: () => void;
  onSetTrollMaterial: (mode: TrollMaterialMode) => void;
  onPreviewSteps: (owner: "player" | "npc") => void;
  onSetStepVolume: (owner: "player" | "npc", value: number) => void;
  onToggleLampMarkers: (on: boolean) => void;
  appearance: CharacterAppearanceV1;
  appearanceStats: AppearanceStats | null;
  onChangeAppearance: (next: CharacterAppearanceV1) => void;
}) {
  const s = stats.stream;
  const nearest = nearestCreature(stats);
  return (
    <div data-testid="forest-diagnostics" className="pointer-events-none max-w-xs rounded-lg bg-black/60 p-2 font-mono text-[11px] leading-snug text-slate-100">
      <div>
        FPS {stats.fps.toFixed(0)} ({stats.frameMs.toFixed(1)} ms) · jakość {stats.quality}
      </div>
      <div>
        draw calls {stats.drawCalls} · trójkąty {(stats.triangles / 1000).toFixed(0)} tys.
      </div>
      <div data-testid="diag-position">
        sektor {s?.center ?? stats.sectorId} · poz. x {stats.position.x.toFixed(1)} y {stats.position.y.toFixed(1)} z {stats.position.z.toFixed(1)}
      </div>
      {s && (
        <div>
          załadowane {s.resident}/{s.wanted} · w kolejce {s.queued} · instancje {stats.visibleInstances}/{s.instances} · cache płytek {s.cachedTiles}
        </div>
      )}
      <div data-testid="diag-nearest">
        najbliższy NPC/zwierzę: {nearest ? `${nearest.name} ${nearest.distance.toFixed(1)} m` : "brak"}
      </div>
      {!stats.npc && !stats.npcError && <div data-testid="npc-diagnostics-empty">troll: niedostępny</div>}
      {!stats.deer && !stats.deerError && <div data-testid="deer-diagnostics-empty">jeleń: niedostępny</div>}
      {stats.npc && (
        <div data-testid="npc-diagnostics" className="mt-1 border-t border-white/20 pt-1">
          <div>
            NPC troll · {stats.npc.visible ? `dystans ${stats.npc.distance.toFixed(1)} m` : "daleko (ukryty)"} · stan {stats.npc.behavior}
          </div>
          <div>
            animacja {stats.npc.clip} ({stats.npc.state}) {stats.npc.clipTime.toFixed(1)}/{stats.npc.clipDuration.toFixed(1)} s
          </div>
          <div>przejście {stats.npc.blend || "-"}</div>
          <div>
            dialog {stats.npc.dialogActive ? "otwarty" : "zamknięty"} · spotkania {stats.npc.encounters} · {stats.npc.armed ? "gotowy na zauważenie" : "rozbrojony"}
          </div>
          <div>
            patrol {stats.npc.patrol} ({stats.npc.routePoints} pkt) · x {stats.npc.x.toFixed(1)} z {stats.npc.z.toFixed(1)}
          </div>
          <div>
            model {stats.npc.bones} kości · {(stats.npc.triangles / 1000).toFixed(1)} tys. trójkątów · {stats.npc.materials} materiał
          </div>
          <button
            type="button"
            data-testid="npc-restart"
            onClick={onRestartEncounter}
            className="pointer-events-auto mt-1 rounded bg-emerald-500 px-2 py-0.5 text-[11px] font-semibold text-emerald-950 hover:bg-emerald-400"
          >
            Powtórz spotkanie (F4)
          </button>
          <TrollMaterialDiagnostics npc={stats.npc} onSetMode={onSetTrollMaterial} />
        </div>
      )}
      {stats.bridge && (
        <div data-testid="bridge-diagnostics" className="mt-1 border-t border-white/20 pt-1">
          <div>
            Most · {stats.bridge.length.toFixed(1)} m · {stats.bridge.bays} segmentów · {(stats.bridge.triangles / 1000).toFixed(1)} tys. trójkątów
          </div>
          <div>
            latarnie {stats.bridge.lamps} · poziom {stats.bridge.level.toFixed(2)} · aktywne światła {stats.bridge.lights}
          </div>
          <button
            type="button"
            data-testid="bridge-lamp-markers"
            onClick={() => onToggleLampMarkers(!stats.bridge?.markers)}
            className="pointer-events-auto mt-1 rounded bg-fuchsia-500 px-2 py-0.5 text-[11px] font-semibold text-fuchsia-950 hover:bg-fuchsia-400"
          >
            Markery latarni: {stats.bridge.markers ? "wyłącz" : "włącz"}
          </button>
        </div>
      )}
      {stats.bridgeError && <div className="text-red-300">model mostu: {stats.bridgeError}</div>}
      {stats.npcError && <div className="text-red-300">model trolla: {stats.npcError}</div>}
      {stats.deer && (
        <div data-testid="deer-diagnostics" className="mt-1 border-t border-white/20 pt-1">
          <div>
            Jeleń · {stats.deer.visible ? `dystans ${stats.deer.distance.toFixed(1)} m` : "daleko (ukryty)"} · {DEER_MODE_LABEL[stats.deer.behavior] ?? stats.deer.behavior}
            {stats.deer.cornered ? " (w kącie)" : ""}
          </div>
          <div>
            animacja {stats.deer.clip} ({stats.deer.state}) {stats.deer.clipTime.toFixed(1)}/{stats.deer.clipDuration.toFixed(1)} s
          </div>
          <div>przejście {stats.deer.blend || "-"} · prędkość {stats.deer.speed.toFixed(2)} m/s</div>
          <div>
            skala {stats.deer.scale.toFixed(2)} (wysokość {stats.deer.height.toFixed(1)} m) · {(stats.deer.triangles / 1000).toFixed(1)} tys. trójkątów · {stats.deer.bones} kości
          </div>
          <div>
            x {stats.deer.x.toFixed(1)} z {stats.deer.z.toFixed(1)} · polana {stats.deer.homeFromStart.toFixed(0)} m od wejścia · od środka {stats.deer.homeDistance.toFixed(1)} m
          </div>
          <div>
            głowa {stats.deer.watching ? "patrzy na gracza" : "rozgląda się"} · yaw {((stats.deer.lookYaw * 180) / Math.PI).toFixed(0)}° pitch {((stats.deer.lookPitch * 180) / Math.PI).toFixed(0)}° · odejścia {stats.deer.retreats}
          </div>
        </div>
      )}
      {stats.deerError && <div className="text-red-300">model jelenia: {stats.deerError}</div>}
      <div data-testid="appearance-diagnostics" className="mt-1 border-t border-white/20 pt-1">
        <div>Wygląd (dev) · zapisywany w grze</div>
        <AppearanceControls appearance={appearance} onChange={onChangeAppearance} compact />
        {appearanceStats ? (
          <div>
            trójkąty: włosy {appearanceStats.triangles.hair} · góra {appearanceStats.triangles.top} · dół {appearanceStats.triangles.bottom} · ciało {appearanceStats.triangles.body} (ukryte {appearanceStats.triangles.bodyHidden}) · +{appearanceStats.extraDrawCalls} draw calls
          </div>
        ) : (
          <div>model postaci niedostępny</div>
        )}
        {appearanceStats?.missing.map((m) => (
          <div key={m.id} className="text-amber-300">
            {m.id}: {m.reason}
          </div>
        ))}
      </div>
      <AudioDiagnostics
        snapshot={audio}
        onSetHour={onSetHour}
        onTestWolves={onTestWolves}
        troll={stats.npc ? { state: stats.npc.state, stepping: stats.npc.stepping, distance: stats.npc.distance, visible: stats.npc.visible } : null}
        onPreviewSteps={onPreviewSteps}
        onSetStepVolume={onSetStepVolume}
      />
    </div>
  );
}

function ControlsHelp() {
  const device = useInputDevice();
  const entries = device === "keyboard" ? FOREST_CONTROLS : padForestHelp(device);
  return (
    <div data-testid="controls-help" className="hidden max-w-[17rem] rounded-lg bg-black/45 px-3 py-2 text-xs text-white backdrop-blur sm:block">
      <p className="mb-1 font-semibold">Sterowanie</p>
      <ul className="space-y-0.5">
        {entries.map((c) => (
          <li key={c.label} className="flex items-baseline gap-1.5">
            <span className="flex shrink-0 gap-0.5">
              {c.keys.map((k) => (
                <kbd key={k} className="rounded bg-white/20 px-1 py-px text-[10px] font-semibold">
                  {k}
                </kbd>
              ))}
            </span>
            <span className="text-slate-200">{c.label}</span>
          </li>
        ))}
        {device === "keyboard" && <li className="pt-0.5 text-slate-300">Mysz – rozglądanie (kliknij w scenę).</li>}
      </ul>
    </div>
  );
}

function takenChestCount(state: GameState): number {
  return Object.values(state.chests).filter((c) => c.taken).length;
}

function openedChestIds(state: GameState): string[] {
  return Object.entries(state.chests)
    .filter(([, c]) => c.opened)
    .map(([id]) => id)
    .sort();
}

export function ForestWorldView({
  seed,
  gameState,
  dispatch,
  startPose,
  bridgeBuilt,
  hour,
  quality,
  onQualityChange,
  suspended,
  onPose,
  onLeave,
  onLoadingChange,
}: ForestWorldViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<ForestRenderer | null>(null);
  const [stats, setStats] = useState<PanelStats | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [debug, setDebug] = useState(false);
  const [trollDialog, setTrollDialog] = useState(false);
  const trollDialogRef = useRef(false);
  const [talkable, setTalkable] = useState(false);
  const [trollMessage, setTrollMessage] = useState<string | null>(null);
  const trollRequestRef = useRef<() => void>(() => {});
  const debugRef = useRef(debug);
  useEffect(() => {
    debugRef.current = debug;
  }, [debug]);
  const genVersion = gameState.world?.genVersion ?? 2;
  const [pose] = useState(() => safeForestPose({ seed, genVersion }, startPose, bridgeBuilt));
  const initial = useRef({ pose, quality, hour, bridgeBuilt, opened: openedChestIds(gameState), harvested: gameState.harvested, appearance: gameState.appearance });
  const stateRef = useRef(gameState);
  const dispatchRef = useRef(dispatch);
  const [snap, setSnap] = useState<InteractorSnapshot>(NO_INTERACTION);
  const [minimap, setMinimap] = useState(readMinimap);
  const device = useInputDevice();
  const [interactor] = useState(() => new ForestInteractor());
  const harvestedSeen = useRef(gameState.harvested.length);
  const changeAppearance = useCallback((next: CharacterAppearanceV1) => dispatchRef.current({ type: "appearance.set", appearance: next }), []);
  const ready = useRef(false);
  const callbacks = useRef({ onPose, onLeave });
  const guard = useRef({ suspended, suspendedEnd: 0, unlockedAt: 0, locked: false });

  useEffect(() => {
    callbacks.current = { onPose, onLeave };
  }, [onPose, onLeave]);
  useEffect(() => {
    stateRef.current = gameState;
    dispatchRef.current = dispatch;
  }, [gameState, dispatch]);
  useEffect(() => {
    interactor.bind({
      getState: () => stateRef.current,
      dispatch: (c) =>
        dispatchWithReactions(
          stateRef.current,
          c,
          (command) => dispatchRef.current(command),
          (reaction) => rendererRef.current?.reactNpc(reaction.npc, reaction.kind),
        ),
      getPose: () => rendererRef.current?.getPose() ?? null,
      requireClearReach: () => rendererRef.current?.isThirdPerson ?? false,
      now: () => performance.now(),
    });
  }, [interactor]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const init = initial.current;
    let renderer: ForestRenderer;
    try {
      renderer = new ForestRenderer({
        container,
        quality: init.quality,
        hour: init.hour,
        stream: {
          seed,
          genVersion,
          pose: init.pose,
          bridgeBuilt: init.bridgeBuilt,
          opened: init.opened,
          harvested: init.harvested,
          // Domyślny widok rozgrywki: postać w trzeciej osobie (ta sama konfiguracja co w /dev/third-person).
          thirdPerson: { config: resolveTppConfig() },
          appearance: init.appearance,
        },
        onStats: setStats,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      queueMicrotask(() => setFatal(message));
      return;
    }
    rendererRef.current = renderer;
    renderer.setInputHub(getInputHub());
    ready.current = false;
    renderer.onNpcDialog(() => {
      // Okno testowe PRAWIDŁOWY/ZŁY tylko w trybie deweloperskim przy otwartym panelu diagnostycznym (O/F3);
      // w normalnej rozgrywce rozmowę prowadzi silnik gry (zagadki trolla).
      if (process.env.NODE_ENV !== "production" && debugRef.current) {
        trollDialogRef.current = true;
        setTrollDialog(true);
        return;
      }
      trollRequestRef.current();
    });
    const audio = getForestAudio();
    renderer.setStepSink(audio);
    audio.setSurfaceResolver((x, z) => renderer.surfaceAt(x, z));
    const report = () => {
      const p = renderer.getPose();
      if (p && ready.current) callbacks.current.onPose(p);
    };
    const id = setInterval(report, POSE_REPORT_MS);
    return () => {
      clearInterval(id);
      report();
      rendererRef.current = null;
      renderer.onNpcDialog(null);
      renderer.setStepSink(null);
      audio.setSurfaceResolver(null);
      trollDialogRef.current = false;
      renderer.dispose();
    };
  }, [seed, genVersion]);

  const loading = !fatal && (stats === null || stats.loading !== null) && !stats?.error;
  useEffect(() => {
    ready.current = !loading && !fatal && !stats?.error;
  }, [loading, fatal, stats?.error]);
  useEffect(() => {
    onLoadingChange(loading);
    return () => onLoadingChange(false);
  }, [loading, onLoadingChange]);

  useEffect(() => rendererRef.current?.setHour(hour), [hour]);
  useEffect(() => rendererRef.current?.setQuality(quality), [quality]);
  useEffect(() => rendererRef.current?.setBridgeBuilt(bridgeBuilt), [bridgeBuilt]);
  // Zmiana wyglądu w trakcie gry (panel deweloperski): wymiana elementów bez restartu świata, kontrolera i animacji.
  useEffect(() => rendererRef.current?.setPlayerAppearance(gameState.appearance), [gameState.appearance]);

  const windowOpen = snap.window !== null;
  useGamePause(dispatch, "ui.panel", "ui.chest", windowOpen);
  useGamePause(dispatch, "ui.panel", "ui.troll_test", trollDialog);
  const buildOpen = snap.buildWindow;
  useGamePause(dispatch, "ui.panel", "ui.bridge_build", buildOpen);
  const frozen = suspended || windowOpen || buildOpen || trollDialog || trollMessage !== null;
  const npcDialog = trollDialog || trollMessage !== null || gameState.dialog !== null;
  const saveId = gameState.world?.saveId ?? null;
  const getPose = useCallback(() => rendererRef.current?.getPose() ?? null, []);
  useForestAudio({ elapsed: gameState.elapsed, saveId, dialog: npcDialog, frozen: frozen || npcDialog, getPose });
  const [audioSnap, setAudioSnap] = useState<AudioSnapshot | null>(null);
  useEffect(() => {
    rendererRef.current?.setSuspended(frozen);
    const g = guard.current;
    if (g.suspended && !frozen) g.suspendedEnd = performance.now();
    g.suspended = frozen;
  }, [frozen]);
  useEffect(() => {
    if (windowOpen || buildOpen || trollDialog || trollMessage !== null || gameState.dialog) document.exitPointerLock?.();
  }, [windowOpen, buildOpen, trollDialog, trollMessage, gameState.dialog]);

  const resolveTrollDialog = useCallback((outcome: DialogOutcome) => {
    if (!trollDialogRef.current) return;
    trollDialogRef.current = false;
    setTrollDialog(false);
    rendererRef.current?.resolveNpcDialog(outcome);
  }, []);

  /** Prośba trolla o rozmowę (po animacji Surprised): silnik decyduje, czy rozmowa się odbywa (blokada, rozwiązana zagadka). */
  const requestTrollTalk = useCallback(() => {
    const renderer = rendererRef.current;
    const pose = renderer?.getPose();
    const state = stateRef.current;
    if (!renderer || !pose) return;
    if (state.dialog) return;
    if (state.troll.phase === "solved") {
      const taken = state.chests["chest.bridge.blueprint"]?.taken;
      setTrollMessage(taken ? "Dobrze ci poszło! Powodzenia przy budowie mostu." : "Zagadkę już rozwiązałeś. Skrzynia ze schematem jest dla ciebie otwarta.");
      return;
    }
    const command: Command = { type: "troll.talk", at: { x: pose.x, z: pose.z } };
    const out = applyCommand(state, command);
    dispatchRef.current(command);
    if (!out.state.dialog) renderer.resolveNpcDialog("dismissed");
  }, []);
  useEffect(() => {
    trollRequestRef.current = requestTrollTalk;
  }, [requestTrollTalk]);

  const chooseTroll = useCallback((choice: "fight" | "talk") => {
    dispatchRef.current({ type: "troll.choose", choice });
  }, []);
  const answerTroll = useCallback((value: number) => {
    const command: Command = { type: "riddle.answer", value };
    const out = applyCommand(stateRef.current, command);
    dispatchRef.current(command);
    const answered = out.events.find((e) => e.type === "troll.riddle_answered");
    if (answered && answered.type === "troll.riddle_answered") rendererRef.current?.resolveNpcDialog(answered.correct ? "correct" : "wrong");
  }, []);
  const closeTroll = useCallback(() => {
    if (stateRef.current.dialog) dispatchRef.current({ type: "dialog.close" });
    setTrollMessage(null);
    rendererRef.current?.resolveNpcDialog("dismissed");
  }, []);
  const setTrollMaterial = useCallback((mode: TrollMaterialMode) => {
    rendererRef.current?.setNpcMaterialMode(mode);
  }, []);
  const toggleLampMarkers = useCallback((on: boolean) => {
    rendererRef.current?.setBridgeLampMarkers(on);
  }, []);
  const restartEncounter = useCallback(() => {
    if (trollDialogRef.current) return;
    rendererRef.current?.restartNpcEncounter();
  }, []);

  const openedKey = openedChestIds(gameState).join("|");
  useEffect(() => {
    rendererRef.current?.setChestStates(openedKey ? openedKey.split("|") : [], true);
  }, [openedKey]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setHarvested(gameState.harvested);
    for (const id of gameState.harvested.slice(harvestedSeen.current)) {
      const obj = forestObject({ seed, genVersion }, id);
      const info = obj ? harvestOf(obj) : null;
      if (obj && info) renderer.burst(info.kind === "tree" ? "wood" : "stone", obj.x, obj.y + (info.kind === "tree" ? 1.4 : 0.5), obj.z);
    }
    harvestedSeen.current = gameState.harvested.length;
  }, [gameState.harvested, seed, genVersion]);

  // Delikatna wibracja pada (opcjonalna): otwarcie skrzyni, zabranie przedmiotu ze skrzyni, ukończenie mostu.
  const rumbleSeen = useRef({ opened: openedChestIds(gameState).length, taken: takenChestCount(gameState), bridge: bridgeBuilt });
  const openedCount = openedKey ? openedKey.split("|").length : 0;
  const takenCount = takenChestCount(gameState);
  useEffect(() => {
    const seen = rumbleSeen.current;
    if (bridgeBuilt && !seen.bridge) rumble("bridge");
    else if (takenCount > seen.taken) rumble("item");
    else if (openedCount > seen.opened) rumble("chest");
    seen.opened = openedCount;
    seen.taken = takenCount;
    seen.bridge = bridgeBuilt;
  }, [openedCount, takenCount, bridgeBuilt]);

  useEffect(() => {
    const id = setInterval(() => {
      if (!ready.current) return;
      setSnap(interactor.poll());
      setTalkable(!trollDialogRef.current && (rendererRef.current?.canTalkToNpc ?? false));
    }, POLL_MS);
    return () => {
      clearInterval(id);
      interactor.reset();
    };
  }, [interactor]);

  useEffect(() => {
    if (!debug) return;
    const audio = getForestAudio();
    const read = () => setAudioSnap({ diag: audio.getDiagnostics(), at: performance.now() });
    read();
    const id = setInterval(read, 250);
    return () => clearInterval(id);
  }, [debug]);
  const setClockHour = useCallback((hour: number) => {
    const target = nextClockTime(stateRef.current.elapsed, hour);
    getForestAudio().jumpClock(target);
    dispatchRef.current({ type: "dev.setClock", elapsed: target });
  }, []);
  const testWolves = useCallback(() => {
    getForestAudio().testWolves();
  }, []);
  const previewSteps = useCallback((owner: "player" | "npc") => {
    getForestAudio().previewSteps(owner);
  }, []);
  const setStepVolume = useCallback((owner: "player" | "npc", value: number) => {
    getForestAudio().setStepVolumes({ [owner]: value });
  }, []);

  const suspendedRef = useRef(suspended);
  useEffect(() => {
    suspendedRef.current = suspended;
  }, [suspended]);
  /**
   * Interakcja (E / ✕ / A): jedna wspólna ścieżka dla klawiatury i pada. Zwraca true, gdy akcja została obsłużona
   * (albo połknięta przez bramkę podwójnej interakcji z drugiego urządzenia).
   */
  const triggerInteract = useCallback((): boolean => {
    if (suspendedRef.current || trollDialogRef.current || !ready.current) return false;
    const handled = getInputHub().interactGate.run(performance.now(), () => interactor.press() || (rendererRef.current?.talkToNpc() ?? false));
    if (handled) setSnap(interactor.snapshot);
    return handled;
  }, [interactor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isGameLetterShortcut(e, "e")) return;
      if (!triggerInteract()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [triggerInteract]);

  const toggleMinimap = useCallback(() => {
    setMinimap((on) => {
      const next = !on;
      try {
        window.localStorage.setItem(MINIMAP_KEY, next ? "on" : "off");
      } catch {
        // zapamiętanie widoczności mapy nie jest krytyczne
      }
      return next;
    });
  }, []);

  /** Minimapa (M / L1) działa tylko w wolnym lesie; to samo sprawdzenie dla klawiatury i pada. */
  const requestMinimapToggle = useCallback(() => {
    if (!suspendedRef.current && !trollDialogRef.current && ready.current) toggleMinimap();
  }, [toggleMinimap]);

  // Pad: interakcja i minimapa używają tych samych funkcji co klawiatura. Gdy nic nie przejmie interakcji,
  // ✕/A robi to co E w pasku ekwipunku: zjada zaznaczony przedmiot (jeśli leczy).
  useInputActions((e) => {
    if (e.source !== "gamepad") return;
    if (e.action === "interact") {
      if (!triggerInteract() && ready.current && !suspendedRef.current && !trollDialogRef.current) {
        const st = stateRef.current;
        const slot = st.slots[st.selected];
        if (slot && !st.dead && ITEMS[slot.id].heal > 0) dispatchRef.current({ type: "eat" });
      }
      return true;
    }
    if (e.action === "minimap") {
      requestMinimapToggle();
      return true;
    }
    return false;
  });

  const locked = stats?.locked ?? false;
  useEffect(() => {
    const g = guard.current;
    if (g.locked && !locked) g.unlockedAt = performance.now();
    g.locked = locked;
  }, [locked]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isDiagnosticsShortcut(e)) {
        e.preventDefault();
        setDebug((d) => !d);
        return;
      }
      if (e.key === "F4" && debugRef.current) {
        e.preventDefault();
        restartEncounter();
        return;
      }
      if (isGameLetterShortcut(e, "m")) {
        requestMinimapToggle();
        return;
      }
      if (e.key !== "Escape") return;
      const g = guard.current;
      const now = performance.now();
      if (g.locked || g.suspended || now - g.unlockedAt < ESC_GUARD_MS || now - g.suspendedEnd < ESC_GUARD_MS) return;
      if (document.querySelector('[data-slot="dialog-content"]')) return;
      callbacks.current.onLeave();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestMinimapToggle, restartEncounter]);

  const error = fatal ?? stats?.error ?? null;
  const percent = Math.round((stats?.loadProgress ?? 0) * 100);

  return (
    <section data-testid="forest-view" className="relative h-full w-full overflow-hidden bg-slate-900">
      <div ref={containerRef} data-testid="forest-canvas" className="absolute inset-0" />

      {!loading && !error && (
        <div
          data-testid="crosshair"
          data-active={snap.target !== null}
          className={cn(
            "pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-all",
            snap.target ? "h-3 w-3 border-2 border-amber-200 bg-amber-200/30" : "h-1.5 w-1.5 bg-white/70",
          )}
          aria-hidden
        />
      )}

      {!loading && !error && talkable && !snap.prompt && !windowOpen && !trollDialog && (
        <div className="pointer-events-none absolute inset-x-0 top-[58%] z-10 flex justify-center px-4">
          <p data-testid="troll-talk-prompt" className="flex items-center gap-2 rounded-full bg-amber-100/90 px-4 py-2 text-sm font-semibold text-amber-950 shadow-xl backdrop-blur">
            <InputHint action="interact" className="rounded bg-amber-950 px-1.5 py-0.5 text-xs text-amber-100" />
            Porozmawiaj z trollem
          </p>
        </div>
      )}

      {!loading && !error && snap.prompt && !windowOpen && (
        <div className="pointer-events-none absolute inset-x-0 top-[58%] z-10 flex justify-center px-4">
          <p
            data-testid="interaction-prompt"
            data-tone={snap.prompt.tone}
            className={cn(
              "flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold shadow-xl backdrop-blur",
              snap.prompt.tone === "action" ? "bg-amber-100/90 text-amber-950" : "bg-slate-900/80 text-slate-100",
            )}
          >
            {snap.prompt.key && <InputHint action="interact" className="rounded bg-amber-950 px-1.5 py-0.5 text-xs text-amber-100" />}
            {snap.prompt.text}
          </p>
        </div>
      )}

      {!loading && !error && minimap && (
        <div className="absolute bottom-3 right-3 z-10 hidden sm:block">
          <Minimap seed={seed} state={gameState} getPose={getPose} size={190} />
        </div>
      )}

      <div className="absolute left-3 top-3 z-10 flex flex-col items-start gap-2 sm:left-5 sm:top-5">
        <Button data-testid="leave-forest" variant="secondary" onClick={onLeave}>
          ← Wróć do miasta
        </Button>
        <div className="flex items-center gap-1 rounded-lg bg-black/45 p-1 backdrop-blur" role="group" aria-label="Jakość grafiki lasu">
          {QUALITIES.map((q) => (
            <button
              key={q}
              type="button"
              data-testid={`quality-${q}`}
              aria-pressed={quality === q}
              onClick={() => onQualityChange(q)}
              className={cn(
                "rounded px-2 py-1 text-xs font-medium transition",
                quality === q ? "bg-emerald-500 text-emerald-950" : "text-slate-200 hover:bg-white/10",
              )}
            >
              {QUALITY_LABEL[q]}
            </button>
          ))}
        </div>
        <AudioControls />
        {!loading && !error && <ControlsHelp />}
        {!loading && !error && process.env.NODE_ENV !== "production" && (
          <button
            type="button"
            data-testid="open-diagnostics"
            aria-pressed={debug}
            onClick={(e) => {
              setDebug((d) => !d);
              e.currentTarget.blur();
            }}
            className={cn(
              "rounded-md px-2 py-1 text-xs font-medium backdrop-blur transition",
              debug ? "bg-emerald-500 text-emerald-950" : "bg-black/45 text-slate-200 hover:bg-white/15",
            )}
          >
            Diagnostyka
          </button>
        )}
        {debug && stats && (
          <DiagnosticsPanel stats={stats} audio={audioSnap} onRestartEncounter={restartEncounter} onSetHour={setClockHour} onTestWolves={testWolves} onSetTrollMaterial={setTrollMaterial} onPreviewSteps={previewSteps} onSetStepVolume={setStepVolume} onToggleLampMarkers={toggleLampMarkers} appearance={gameState.appearance} appearanceStats={stats.appearance ?? null} onChangeAppearance={changeAppearance} />
        )}
      </div>

      {!loading && !error && !locked && !suspended && !trollDialog && device === "keyboard" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-24 z-10 flex justify-center">
          <p data-testid="forest-click-hint" className="rounded-full bg-black/60 px-4 py-2 text-sm font-medium text-white backdrop-blur">
            Kliknij w scenę, aby sterować myszą
          </p>
        </div>
      )}

      {loading && (
        <div data-testid="forest-loading" role="status" className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-slate-950 p-6 text-center">
          <p className="text-lg font-semibold text-white">Wchodzisz do lasu…</p>
          <div className="h-2.5 w-64 overflow-hidden rounded-full bg-slate-700" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-emerald-400 transition-[width]" style={{ width: `${percent}%` }} />
          </div>
          <p className="text-xs text-slate-400">{stats?.loading ?? "Przygotowanie sceny"}</p>
        </div>
      )}

      {error && (
        <div data-testid="forest-error" role="alert" className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-slate-950/95 p-6 text-center">
          <p className="text-lg font-semibold text-red-300">Nie udało się wczytać lasu</p>
          <p className="max-w-md text-sm text-slate-300">{error}</p>
          <p className="max-w-md text-xs text-slate-500">Las wymaga przeglądarki z włączoną akceleracją WebGL. Postęp gry jest bezpieczny, możesz wrócić do miasta.</p>
          <Button onClick={onLeave}>Wróć do miasta</Button>
        </div>
      )}

      <Dialog open={windowOpen} onOpenChange={(o) => !o && interactor.closeWindow()}>
        <DialogContent className="max-w-sm border-amber-200/30 bg-slate-900 text-white" data-testid="chest-window" initialFocus={preferredInitialFocus}>
          <DialogHeader>
            <DialogTitle>Baśniowa skrzynia</DialogTitle>
            <DialogDescription className="text-slate-400">W środku coś leży.</DialogDescription>
          </DialogHeader>
          {snap.window && (
            <div data-testid="chest-contents" className="flex items-center gap-3 rounded-xl border border-amber-200/30 bg-amber-100/5 p-3">
              <span aria-hidden className="text-4xl">
                {ITEMS[snap.window.item].emoji}
              </span>
              <span className="min-w-0">
                <span className="block text-base font-bold text-amber-100">{ITEMS[snap.window.item].name}</span>
                <span className="block text-xs text-slate-300">{ITEMS[snap.window.item].description}</span>
              </span>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button
              data-testid="chest-leave"
              variant="secondary"
              onClick={() => {
                interactor.closeWindow();
                setSnap(interactor.snapshot);
              }}
            >
              Zostaw
            </Button>
            <Button
              data-testid="chest-take"
              data-gamepad-initial=""
              onClick={() => {
                interactor.takeFromWindow();
                setSnap(interactor.snapshot);
              }}
            >
              Zabierz <InputHint action="interact" padAction="confirm" className="ml-1" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <BridgeBuildDialog
        open={buildOpen}
        state={gameState}
        onBuild={() => {
          interactor.confirmBuild();
          setSnap(interactor.snapshot);
        }}
        onClose={() => {
          interactor.closeBuildWindow();
          setSnap(interactor.snapshot);
        }}
      />
      <TrollDialog dialog={gameState.dialog} message={trollMessage} onChoose={chooseTroll} onAnswer={answerTroll} onClose={closeTroll} />
      <TrollTestDialog open={trollDialog} onOutcome={resolveTrollDialog} />
    </section>
  );
}
