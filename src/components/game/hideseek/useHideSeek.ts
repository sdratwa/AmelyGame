"use client";

import { useSyncExternalStore } from "react";
import type { MultiplayerClient } from "@/lib/multiplayer/client";
import type { HsStateView } from "@/lib/hideseek/types";

const noopSubscribe = () => () => {};

/** Aktualny widok zabawy z serwera (null: brak klienta online albo brak zabawy); odświeża się przy każdej zmianie stanu. */
export function useHideSeekView(client?: MultiplayerClient): HsStateView | null {
  const hs = client?.hs;
  useSyncExternalStore(hs ? hs.subscribe.bind(hs) : noopSubscribe, () => hs?.version ?? 0, () => 0);
  return hs?.view ?? null;
}
