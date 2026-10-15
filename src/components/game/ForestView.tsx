"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ITEMS, type ForestPose, type ItemId, type Season } from "@/lib/game/engine";
import { PhoneIcon } from "./art";
import { emptyInput, type MoveInput } from "./ForestScene";

const ForestScene = dynamic(() => import("./ForestScene"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-slate-900 text-slate-300">
      Wchodzisz do lasu…
    </div>
  ),
});

const DEFAULT_POSE: ForestPose = { x: 0, z: 0, yaw: 0 };
const POSE_REPORT_MS = 2000;

const KEYMAP: Record<string, keyof MoveInput> = {
  ArrowUp: "forward",
  w: "forward",
  W: "forward",
  ArrowDown: "back",
  s: "back",
  S: "back",
  ArrowLeft: "turnLeft",
  ArrowRight: "turnRight",
  a: "strafeLeft",
  A: "strafeLeft",
  d: "strafeRight",
  D: "strafeRight",
};

function Hand({ item }: { item: ItemId | null }) {
  return (
    <div
      data-testid="hand"
      data-item={item ?? ""}
      className="pointer-events-none absolute -bottom-6 right-[8%] z-10 w-24 origin-bottom animate-[hand-sway_4s_ease-in-out_infinite] sm:right-[14%] sm:w-32"
      aria-label={item ? `W ręku: ${ITEMS[item].name}` : "Pusta ręka"}
    >
      <svg viewBox="0 0 120 150" className="h-auto w-full drop-shadow-xl">
        <path d="M30 150 L40 78 L92 78 L104 150 Z" fill="#1e3a5f" />
        <path d="M34 120 L98 120 L104 150 L30 150 Z" fill="#16304f" />
        <rect x="38" y="62" width="56" height="30" rx="10" fill="#f1c9a5" />
        <g fill="#f1c9a5" stroke="#d7a67f" strokeWidth="1.5">
          <rect x="34" y="30" width="13" height="42" rx="6.5" />
          <rect x="49" y="24" width="13" height="48" rx="6.5" />
          <rect x="64" y="26" width="13" height="46" rx="6.5" />
          <rect x="79" y="34" width="13" height="38" rx="6.5" />
        </g>
        <rect x="28" y="56" width="18" height="12" rx="6" fill="#f1c9a5" stroke="#d7a67f" strokeWidth="1.5" transform="rotate(-25 37 62)" />
      </svg>
      <div className="absolute left-1/2 top-[-18%] flex -translate-x-1/2 items-center justify-center">
        {item === "phone" ? (
          <PhoneIcon className="h-16 -rotate-6 drop-shadow-lg sm:h-24" />
        ) : item ? (
          <span className="text-5xl drop-shadow-lg sm:text-6xl" aria-hidden>
            {ITEMS[item].emoji}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function PadButton({
  label,
  field,
  input,
  className = "",
}: {
  label: string;
  field: keyof MoveInput;
  input: React.RefObject<MoveInput>;
  className?: string;
}) {
  const set = (v: boolean) => () => {
    input.current[field] = v;
  };
  return (
    <button
      aria-label={label}
      onPointerDown={set(true)}
      onPointerUp={set(false)}
      onPointerLeave={set(false)}
      onPointerCancel={set(false)}
      onContextMenu={(e) => e.preventDefault()}
      className={`flex h-12 w-12 select-none items-center justify-center rounded-xl bg-black/45 text-xl text-white backdrop-blur active:bg-white/40 ${className}`}
      style={{ touchAction: "none" }}
    >
      {label}
    </button>
  );
}

export function ForestView({
  season,
  isDay,
  held,
  startPose,
  onPose,
  onLeave,
}: {
  season: Season;
  isDay: boolean;
  held: ItemId | null;
  startPose: ForestPose | null;
  onPose: (pose: ForestPose) => void;
  onLeave: () => void;
}) {
  const input = useRef<MoveInput>(emptyInput());
  const [start] = useState<ForestPose>(() => startPose ?? DEFAULT_POSE);
  const poseRef = useRef<ForestPose>(start);
  const onPoseRef = useRef(onPose);

  useEffect(() => {
    onPoseRef.current = onPose;
  }, [onPose]);

  useEffect(() => {
    const report = () => onPoseRef.current(poseRef.current);
    const id = setInterval(report, POSE_REPORT_MS);
    return () => {
      clearInterval(id);
      report();
    };
  }, []);

  useEffect(() => {
    const cur = input.current;
    const down = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onLeave();
      const field = KEYMAP[e.key];
      if (field) {
        e.preventDefault();
        cur[field] = true;
      }
    };
    const up = (e: KeyboardEvent) => {
      const field = KEYMAP[e.key];
      if (field) cur[field] = false;
    };
    const blur = () => Object.assign(cur, emptyInput());
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [onLeave]);

  return (
    <section data-testid="forest-view" className="relative h-full w-full overflow-hidden bg-slate-900">
      <ForestScene
        season={season}
        isDay={isDay}
        input={input}
        startPose={start}
        poseRef={poseRef}
      />

      <div className="pointer-events-none absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/70" aria-hidden />

      <div className="absolute left-3 top-3 z-10 flex flex-col gap-2 sm:left-5 sm:top-5">
        <Button data-testid="leave-forest" variant="secondary" onClick={onLeave}>
          ← Wróć na mapę (Esc)
        </Button>
        <p className="hidden max-w-[16rem] rounded-lg bg-black/45 px-3 py-2 text-xs text-white backdrop-blur sm:block">
          Strzałki ↑↓ – chodzenie, ←→ – obrót. W/S – przód/tył, A/D – bokiem.
        </p>
      </div>

      <div className="absolute bottom-3 left-3 z-10 grid grid-cols-3 gap-1.5 sm:hidden" data-testid="touch-pad">
        <span />
        <PadButton label="↑" field="forward" input={input} />
        <span />
        <PadButton label="←" field="turnLeft" input={input} />
        <PadButton label="↓" field="back" input={input} />
        <PadButton label="→" field="turnRight" input={input} />
      </div>

      <Hand item={held} />
    </section>
  );
}
