"use client";

import { useEffect, useState } from "react";
import { LogOut, RefreshCw, Users, Wifi, WifiOff } from "lucide-react";
import type { MultiplayerClient } from "@/lib/multiplayer/client";
import { cn } from "@/lib/utils";

const POLL_MS = 500;
const MAX_PLAYERS = 8;

const CHIP = "flex h-8 items-center gap-1 rounded-full bg-slate-900/60 px-2 text-[11px] font-semibold tabular-nums text-slate-100 backdrop-blur-sm";

/**
 * Lekki status online na telefonie: ikona połączenia, "2/8", wyjście i (przy utracie połączenia) ponowne łączenie.
 * Sam odpytuje klienta rzadko i renderuje się tylko przy zmianie wartości, więc nie obciąża reszty interfejsu.
 */
export function OnlineChip({
  client,
  onExit,
  onReconnect,
}: {
  client: MultiplayerClient;
  onExit?: () => Promise<void>;
  onReconnect?: () => Promise<void>;
}) {
  const [status, setStatus] = useState(client.status);
  const [count, setCount] = useState(client.online || client.players.length);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const read = () => {
      setStatus(client.status);
      setCount(client.online || client.players.length);
    };
    read();
    const id = setInterval(read, POLL_MS);
    return () => clearInterval(id);
  }, [client]);

  const connected = status === "połączony";
  const run = (fn?: () => Promise<void>) => async () => {
    if (!fn || pending) return;
    setPending(true);
    try {
      await fn();
    } finally {
      setPending(false);
    }
  };

  return (
    <div data-testid="online-chip" className="pointer-events-auto flex items-center gap-1">
      <span className={cn(CHIP, connected ? "text-emerald-200" : "text-amber-200")} title={status} aria-label={`Online: ${status}, graczy ${count} z ${MAX_PLAYERS}`}>
        {connected ? <Wifi className="size-3.5" aria-hidden /> : <WifiOff className="size-3.5" aria-hidden />}
        <Users className="size-3.5" aria-hidden />
        <span data-testid="online-count">
          {count}/{MAX_PLAYERS}
        </span>
      </span>
      {!connected && onReconnect && (
        <button type="button" data-testid="online-reconnect" aria-label="Połącz ponownie" disabled={pending} onClick={run(onReconnect)} className={cn(CHIP, "w-8 justify-center px-0 active:bg-white/30")}>
          <RefreshCw className="size-4" aria-hidden />
        </button>
      )}
      {onExit && (
        <button type="button" data-testid="online-exit" aria-label="Wyjdź online" disabled={pending} onClick={run(onExit)} className={cn(CHIP, "w-8 justify-center px-0 active:bg-white/30")}>
          <LogOut className="size-4" aria-hidden />
        </button>
      )}
    </div>
  );
}
