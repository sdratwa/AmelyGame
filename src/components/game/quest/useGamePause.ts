import { useEffect } from "react";
import type { Command } from "@/lib/game/engine";

/** Wstrzymuje zegar gry, dopóki `active` jest prawdziwe; sprząta po odmontowaniu komponentu. */
export function useGamePause(dispatch: (command: Command) => void, owner: string, reason: string, active: boolean) {
  useEffect(() => {
    if (!active) return;
    dispatch({ type: "pause.add", owner, reason });
    return () => dispatch({ type: "pause.remove", owner, reason });
  }, [dispatch, owner, reason, active]);
}
