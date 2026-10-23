"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowUp, ChevronsDown, Hand } from "lucide-react";
import type { TouchInput } from "@/lib/input/touchInput";
import { VirtualJoystick } from "@/lib/input/touchJoystick";
import { touchZoneOf } from "@/lib/input/touchZones";
import { cn } from "@/lib/utils";

const NO_CALLOUT: CSSProperties = { WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none", touchAction: "none" };

/** Odstępy od krawędzi uwzględniają safe area (notch, pasek domowy). */
/** Prawy dolny róg zajmuje minimapa (`TouchMinimap`), więc przyciski akcji są przesunięte na lewo od niej. */
const EDGE_X = "calc(max(0.5rem, var(--sar)) + 7.25rem)";
const EDGE_L = "max(1rem, var(--sal))";
const EDGE_B = "max(0.75rem, var(--sab))";

const ACTION_BASE =
  "absolute flex touch-none select-none flex-col items-center justify-center rounded-full border border-white/30 bg-slate-900/45 text-white shadow-lg backdrop-blur-sm transition-transform active:scale-90 active:bg-white/35";

type Props = {
  touch: TouchInput;
  /** Interakcja (skrzynia, drzewo, rozmowa, zjedzenie): ta sama ścieżka co E i pad (przez `InputHub`). */
  onInteract: () => void;
  /** Jest cel interakcji w zasięgu: przycisk jest podświetlony. */
  interactReady: boolean;
};

/**
 * Warstwa sterowania dotykowego nad sceną lasu: pływający joystick (lewa strefa), obrót kamery przeciągnięciem (reszta
 * ekranu) i przyciski akcji. Wejście trafia do `TouchInput` (mutowalny stan czytany przez renderer w klatce); gałka i
 * baza są przesuwane bezpośrednio przez `style`, więc ruch palca nie powoduje renderów Reacta.
 */
export function TouchControls({ touch, onInteract, interactReady }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const [joy] = useState(() => new VirtualJoystick());
  const moveId = useRef<number | null>(null);
  const lookId = useRef<number | null>(null);
  const last = useRef({ x: 0, y: 0 });

  const paintJoystick = useCallback(() => {
    const base = baseRef.current;
    const knob = knobRef.current;
    const ghost = ghostRef.current;
    if (!base || !knob || !ghost) return;
    base.style.opacity = joy.active ? "1" : "0";
    ghost.style.opacity = joy.active ? "0" : "";
    base.style.transform = `translate3d(${joy.originX - joy.radius}px, ${joy.originY - joy.radius}px, 0)`;
    knob.style.transform = `translate3d(${joy.knobX}px, ${joy.knobY}px, 0)`;
    knob.dataset.run = joy.run ? "1" : "0";
  }, [joy]);

  const endMove = useCallback(() => {
    moveId.current = null;
    joy.end();
    touch.clearMove();
    paintJoystick();
  }, [joy, touch, paintJoystick]);

  const releaseAll = useCallback(() => {
    endMove();
    lookId.current = null;
    touch.reset();
  }, [endMove, touch]);

  useEffect(() => {
    // Utrata fokusu (np. system zabrał dotyk, zmiana karty): nigdy nie zostawiamy "zablokowanego" ruchu.
    const onHide = () => releaseAll();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("blur", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("blur", onHide);
      window.removeEventListener("pagehide", onHide);
      releaseAll();
    };
  }, [releaseAll]);

  const local = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, width: r.width };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = local(e);
    if (touchZoneOf(p.x, p.width) === "move" && moveId.current === null) {
      moveId.current = e.pointerId;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      joy.begin(p.x, p.y);
      touch.setMove(joy.x, joy.y, joy.run);
      paintJoystick();
    } else if (lookId.current === null) {
      lookId.current = e.pointerId;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      last.current.x = e.clientX;
      last.current.y = e.clientY;
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerId === moveId.current) {
      const p = local(e);
      if (joy.move(p.x, p.y)) {
        touch.setMove(joy.x, joy.y, joy.run);
        paintJoystick();
      }
    } else if (e.pointerId === lookId.current) {
      touch.addLook(e.clientX - last.current.x, e.clientY - last.current.y);
      last.current.x = e.clientX;
      last.current.y = e.clientY;
    }
  };

  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerId === moveId.current) endMove();
    else if (e.pointerId === lookId.current) lookId.current = null;
  };

  /** Przyciski reagują na dotknięcie (nie na "click"), bez opóźnienia i bez uruchamiania kamery pod spodem. */
  const press = (action: () => void) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.preventDefault();
    action();
  };

  return (
    <div
      ref={rootRef}
      data-testid="touch-controls"
      className="absolute inset-0 z-[15] touch-none select-none"
      style={NO_CALLOUT}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={onPointerEnd}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Podpowiedź miejsca joysticka; znika, gdy palec jest na ekranie. */}
      <div
        ref={ghostRef}
        aria-hidden
        className="pointer-events-none absolute size-28 rounded-full border-2 border-white/25 bg-white/5 transition-opacity"
        style={{ left: `calc(${EDGE_L} + 1.25rem)`, bottom: `calc(${EDGE_B} + 0.75rem)` }}
      />
      {/* Pływający joystick: ustawiany w miejscu dotknięcia. */}
      <div
        ref={baseRef}
        data-testid="touch-joystick"
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 size-28 rounded-full border-2 border-white/40 bg-slate-900/30 opacity-0 will-change-transform"
      >
        <div
          ref={knobRef}
          className="absolute left-1/2 top-1/2 -ml-6 -mt-6 size-12 rounded-full border border-white/60 bg-white/50 shadow-md will-change-transform data-[run='1']:bg-amber-200/80"
        />
      </div>

      <button
        type="button"
        data-testid="touch-crouch"
        aria-label="Kucnij"
        onPointerDown={press(() => touch.pressCrouch())}
        className={cn(ACTION_BASE, "size-[3.25rem]")}
        style={{ right: `calc(${EDGE_X} + 0.5rem)`, bottom: `calc(${EDGE_B} + 6.25rem)`, ...NO_CALLOUT }}
      >
        <ChevronsDown className="size-5" aria-hidden />
        <span className="text-[9px] font-semibold leading-none">Kucnij</span>
      </button>
      <button
        type="button"
        data-testid="touch-jump"
        aria-label="Skok"
        onPointerDown={press(() => touch.pressJump())}
        className={cn(ACTION_BASE, "size-[3.75rem]")}
        style={{ right: `calc(${EDGE_X} + 5.75rem)`, bottom: `calc(${EDGE_B} + 1.75rem)`, ...NO_CALLOUT }}
      >
        <ArrowUp className="size-6" aria-hidden />
        <span className="text-[9px] font-semibold leading-none">Skok</span>
      </button>
      <button
        type="button"
        data-testid="touch-interact"
        data-ready={interactReady}
        aria-label="Interakcja"
        onPointerDown={press(onInteract)}
        className={cn(
          ACTION_BASE,
          "size-[4.75rem]",
          interactReady ? "border-amber-200 bg-amber-300/60 text-amber-950 ring-4 ring-amber-200/50" : "",
        )}
        style={{ right: `calc(${EDGE_X} + 0.25rem)`, bottom: `calc(${EDGE_B} + 0.25rem)`, ...NO_CALLOUT }}
      >
        <Hand className="size-7" aria-hidden />
        <span className="text-[10px] font-bold leading-none">Użyj</span>
      </button>
    </div>
  );
}
