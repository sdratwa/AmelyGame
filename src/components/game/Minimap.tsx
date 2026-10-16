"use client";

import { useEffect, useMemo, useRef } from "react";
import type { GameState } from "@/lib/game/engine";
import { arrowRotation, buildMinimapModel, projectToMap, searchAreas, type MinimapModel } from "@/lib/game/systems/minimap";

export type MinimapPose = { x: number; z: number; yaw: number };

const FRAME_MS = 50;

type Palette = { ground: string; river: string; riverEdge: string; trail: string; trailMain: string; frame: string; area: string; areaEdge: string };

const PALETTE: Palette = {
  ground: "#3f5a35",
  river: "#4f9aa6",
  riverEdge: "#8fd0d4",
  trail: "rgba(226,201,150,0.55)",
  trailMain: "rgba(238,214,160,0.9)",
  frame: "#d9b36a",
  area: "rgba(255,214,102,0.16)",
  areaEdge: "rgba(255,214,102,0.85)",
};

/** Warstwa stała (teren, rzeka, ścieżki, wejście) rysowana raz na seed: klatka mapy tylko ją kopiuje i dokłada gracza. */
function paintStatic(model: MinimapModel, px: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const at = (p: { x: number; z: number }) => projectToMap(model.bounds, px, p);

  const grad = ctx.createRadialGradient(px / 2, px / 2, px * 0.1, px / 2, px / 2, px * 0.75);
  grad.addColorStop(0, "#4b6a3e");
  grad.addColorStop(1, "#33492d");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, px, px);

  const ribbon = (poly: { x: number; z: number }[]) => {
    poly.forEach((p, i) => {
      const q = at(p);
      if (i === 0) ctx.moveTo(q.x, q.y);
      else ctx.lineTo(q.x, q.y);
    });
  };
  ctx.beginPath();
  ribbon(model.river.left);
  for (let i = model.river.right.length - 1; i >= 0; i--) {
    const q = at(model.river.right[i]);
    ctx.lineTo(q.x, q.y);
  }
  ctx.closePath();
  ctx.fillStyle = PALETTE.river;
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = PALETTE.riverEdge;
  ctx.beginPath();
  ribbon(model.river.left);
  ctx.stroke();
  ctx.beginPath();
  ribbon(model.river.right);
  ctx.stroke();

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const trail of model.trails) {
    ctx.beginPath();
    ribbon(trail.points);
    ctx.lineWidth = trail.main ? 3 : 2;
    ctx.strokeStyle = trail.main ? PALETTE.trailMain : PALETTE.trail;
    ctx.setLineDash(trail.main ? [] : [4, 4]);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  const e = at(model.entry);
  ctx.fillStyle = "#fff6d8";
  ctx.strokeStyle = "#5a3d1c";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(e.x, e.y - 7);
  ctx.lineTo(e.x + 6, e.y + 5);
  ctx.lineTo(e.x - 6, e.y + 5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  return canvas;
}

export function Minimap({ seed, state, getPose, size = 200 }: { seed: number; state: GameState; getPose: () => MinimapPose | null; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const model = useMemo(() => buildMinimapModel(seed), [seed]);
  const world = state.world;
  const areas = useMemo(
    () => searchAreas(state),
    // searchAreas zależy tylko od tych części stanu; reszta (zegar, zdrowie) zmienia się co tick i nie powinna jej przeliczać.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [world, state.quests, state.ledger.gained, state.chests],
  );
  const areasRef = useRef(areas);
  useEffect(() => {
    areasRef.current = areas;
  }, [areas]);
  const poseRef = useRef(getPose);
  useEffect(() => {
    poseRef.current = getPose;
  }, [getPose]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px = Math.round(size * dpr);
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const base = paintStatic(model, px);
    let raf = 0;
    let last = 0;
    const at = (p: { x: number; z: number }) => projectToMap(model.bounds, px, p);
    const k = px / size;

    const draw = (time: number) => {
      raf = requestAnimationFrame(draw);
      if (time - last < FRAME_MS) return;
      last = time;
      ctx.clearRect(0, 0, px, px);
      ctx.drawImage(base, 0, 0);

      for (const a of areasRef.current) {
        const c = at(a);
        const r = (a.r / (model.bounds.maxX - model.bounds.minX)) * px;
        ctx.beginPath();
        ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
        ctx.fillStyle = PALETTE.area;
        ctx.fill();
        ctx.setLineDash([6 * k, 5 * k]);
        ctx.lineWidth = 1.6 * k;
        ctx.strokeStyle = PALETTE.areaEdge;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = PALETTE.areaEdge;
        ctx.font = `bold ${16 * k}px serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("?", c.x, c.y);
      }

      const pose = poseRef.current();
      if (pose) {
        const p = at(pose);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(arrowRotation(pose.yaw));
        ctx.beginPath();
        ctx.moveTo(0, -9 * k);
        ctx.lineTo(6 * k, 7 * k);
        ctx.lineTo(0, 3.5 * k);
        ctx.lineTo(-6 * k, 7 * k);
        ctx.closePath();
        ctx.fillStyle = "#fff3c4";
        ctx.strokeStyle = "#3a2410";
        ctx.lineWidth = 1.8 * k;
        ctx.fill();
        ctx.stroke();
        ctx.restore();
        ctx.font = `${10 * k}px ui-monospace, monospace`;
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        const label = `x ${Math.round(pose.x)}  z ${Math.round(pose.z)}`;
        ctx.fillStyle = "rgba(10,18,8,0.65)";
        ctx.fillRect(4 * k, px - 18 * k, ctx.measureText(label).width + 8 * k, 14 * k);
        ctx.fillStyle = "#f4e6bf";
        ctx.fillText(label, 8 * k, px - 7.5 * k);
      }

      ctx.font = `bold ${12 * k}px serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = "#f4e6bf";
      ctx.fillText("N", px / 2, 4 * k);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [model, size]);

  return (
    <figure
      data-testid="minimap"
      aria-label="Minimapa lasu"
      className="pointer-events-none rounded-2xl border-2 bg-slate-950/80 p-1.5 shadow-xl backdrop-blur"
      style={{ borderColor: PALETTE.frame }}
    >
      <canvas ref={canvasRef} data-testid="minimap-canvas" className="block rounded-xl" style={{ width: size, height: size }} />
      <figcaption className="mt-1 flex items-center justify-between px-1 text-[10px] text-amber-100/90">
        <span>Las 300 × 300 m</span>
        <span>M – ukryj</span>
      </figcaption>
    </figure>
  );
}
