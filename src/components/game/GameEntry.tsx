"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTouchUi } from "@/components/input/hooks";
import { GameApp } from "./GameApp";
import { MultiplayerClient } from "@/lib/multiplayer/client";
import { getForestAudio } from "@/lib/audio/controller";
export function GameEntry() {
  const [mode, setMode] = useState<"menu" | "solo" | "online">("menu");
  const [client] = useState(() => new MultiplayerClient());
  const exitSaverRef = useRef<(() => Promise<boolean>) | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [, refresh] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => refresh((n) => n + 1), 250);
    return () => {
      clearInterval(timer);
      client.disconnect();
    };
  }, [client]);
  const touchUi = useTouchUi();
  const join = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const endpoint =
        process.env.NEXT_PUBLIC_MULTIPLAYER_URL ||
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}:2567`;
      await client.connect(endpoint);
      client.setSoundHandler((e) => {
        void getForestAudio().playPlayerSound(e);
      });
      setMode("online");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Serwer niedostępny");
    } finally {
      setBusy(false);
    }
  }, [client]);
  /** Wyjście online: zapis postępu, rozłączenie i powrót do menu (nagłówek na desktopie, przycisk w HUD na telefonie). */
  const exitOnline = useCallback(async () => {
    setBusy(true);
    try {
      if (exitSaverRef.current && !(await exitSaverRef.current())) return;
      client.disconnect();
      setMode("menu");
    } finally {
      setBusy(false);
    }
  }, [client]);
  const reconnect = useCallback(async () => {
    await join();
  }, [join]);
  if (mode === "solo") return <GameApp />;
  if (mode === "menu")
    return (
      <div className="safe-pad flex h-full flex-col items-center justify-center gap-5">
        <h1 className="text-3xl">Miasto</h1>
        <button onClick={() => setMode("solo")}>Gra solo</button>
        <button disabled={busy} onClick={() => void join()}>
          {busy ? "Łączenie…" : "Gra online"}
        </button>
        {error && <p role="alert">{error}</p>}
      </div>
    );
  const audio = getForestAudio();
  if (touchUi) {
    // Telefon: bez nagłówka; status online, liczba graczy i wyjście są kompaktowymi chipami w HUD gry.
    return (
      <div className="relative h-full min-h-0">
        <GameApp multiplayer={client} exitSaverRef={exitSaverRef} onExitOnline={exitOnline} onReconnect={reconnect} />
        {error && (
          <p role="alert" className="pointer-events-none absolute left-1/2 top-[calc(max(0.25rem,var(--sat))+3rem)] z-50 -translate-x-1/2 rounded-full bg-red-600/90 px-3 py-1 text-xs text-white">
            {error}
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative z-10 shrink-0 bg-slate-900 px-3 py-2 text-sm text-white">
        <p>
          {client.status} · Online: {client.players.length}/8
        </p>

        <button className="mr-4"
          disabled={busy}
          onClick={() => void exitOnline()}
        >
          Wyjdź online
        </button>
        {client.status !== "połączony" && (
          <button disabled={busy} onClick={() => void join()}>
            Połącz ponownie
          </button>
        )}
        {error && <p>{error}</p>}
        {process.env.NODE_ENV !== "production" && (
          <details className="max-h-[30vh] overflow-auto">
            <summary>Multiplayer / audio</summary>
            <p>{client.notice}</p>
            <pre className="max-h-48 overflow-auto text-xs">
              {JSON.stringify(
                {
                  world: client.config,
                  playerId: client.local?.playerId,
                  ping: client.ping,
                  updates: client.updates,
                  players: client.players,
                  audio: audio.getDiagnostics().contextState,
                  ...audio.spatialDiagnostics(),
                },
                null,
                2,
              )}
            </pre>
            <label>
              Interpolacja ms{" "}
              <input
                type="range"
                min="50"
                max="250"
                value={client.interpolationMs}
                onChange={(e) => {
                  client.setInterpolation(Number(e.target.value));
                  refresh((n) => n + 1);
                }}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={audio.spatialSettings.enabled}
                onChange={(e) => {
                  audio.configureSpatial({ enabled: e.target.checked });
                  refresh((n) => n + 1);
                }}
              />
              Kroki innych graczy
            </label>
            {(
              [
                "volume",
                "walkRange",
                "runRange",
                "crouchRange",
                "rolloff",
              ] as const
            ).map((key) => (
              <label className="block" key={key}>
                {key}
                <input
                  type="number"
                  min="0.1"
                  max={key.includes("Range") ? 150 : 3}
                  step="0.1"
                  value={audio.spatialSettings[key]}
                  onChange={(e) => {
                    audio.configureSpatial({
                      [key]: Math.max(
                        0.1,
                        Math.min(150, Number(e.target.value) || 0.1),
                      ),
                    });
                    refresh((n) => n + 1);
                  }}
                />
              </label>
            ))}
            <p>Okrzyk pomocy: brak pliku audio.</p>
          </details>
        )}
      </div>
      <div className="relative min-h-0 flex-1">
        <GameApp multiplayer={client} exitSaverRef={exitSaverRef} />
      </div>
    </div>
  );
}
