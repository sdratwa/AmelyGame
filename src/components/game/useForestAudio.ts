"use client";

import { useEffect, useRef } from "react";
import { getForestAudio } from "@/lib/audio/controller";

const POSE_POLL_MS = 50;

type Options = {
  /** Czas gry (s) ze stanu gry: źródło prawdy dla pory dnia i północy. */
  elapsed: number;
  saveId: string | null;
  /** Dialog z postacią: cichy ambient, mniej zwierząt, bez kroków. */
  dialog: boolean;
  /** Ruch zablokowany (panel, okno, dialog): bez kroków. */
  frozen: boolean;
  getPose: () => { x: number; z: number; yaw: number } | null;
};

/**
 * Łączy widok lasu z jedynym kontrolerem audio: wejście i wyjście z lasu, czas gry, tryb (dialog i blokada ruchu)
 * oraz pozycja gracza (kroki i orientacja słuchacza). Nie tworzy własnego dźwięku.
 */
export function useForestAudio({ elapsed, saveId, dialog, frozen, getPose }: Options) {
  const initial = useRef({ elapsed, dialog, frozen });
  const poseRef = useRef(getPose);

  useEffect(() => {
    poseRef.current = getPose;
  }, [getPose]);

  useEffect(() => {
    const audio = getForestAudio();
    const start = initial.current;
    audio.setMode({ dialog: start.dialog, frozen: start.frozen });
    audio.enter({ elapsed: start.elapsed, saveId });
    const id = setInterval(() => {
      const pose = poseRef.current();
      if (pose) audio.setPose(pose);
    }, POSE_POLL_MS);
    return () => {
      clearInterval(id);
      audio.leave();
    };
  }, [saveId]);

  useEffect(() => {
    getForestAudio().setClock(elapsed);
  }, [elapsed]);

  useEffect(() => {
    getForestAudio().setMode({ dialog, frozen });
  }, [dialog, frozen]);
}
