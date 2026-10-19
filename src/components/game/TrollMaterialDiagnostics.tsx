"use client";

import type { NpcStats } from "@/lib/forest-view/npc";
import type { TrollMaterialMode } from "@/lib/npc/trollMaterials";

const pct = (v: number) => `${Math.round(v * 100)}%`;
const num = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2));

/** Sekcja MATERIAŁY TROLLA panelu diagnostycznego: przełącznik ORIGINAL / MATTE i rzeczywiste parametry materiału na modelu. */
export function TrollMaterialDiagnostics({ npc, onSetMode }: { npc: NpcStats; onSetMode: (mode: TrollMaterialMode) => void }) {
  const r = npc.materialReport;
  const button = (mode: TrollMaterialMode, label: string) => (
    <button
      type="button"
      data-testid={`troll-material-${mode}`}
      aria-pressed={npc.materialMode === mode}
      onClick={(e) => {
        onSetMode(mode);
        e.currentTarget.blur();
      }}
      className={`pointer-events-auto rounded px-1.5 py-0.5 text-[10px] font-semibold ${
        npc.materialMode === mode ? "bg-amber-300 text-amber-950" : "bg-slate-600 text-slate-100 hover:bg-slate-500"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div data-testid="troll-materials" className="mt-1 border-t border-white/20 pt-1">
      <div>MATERIAŁY TROLLA · aktywne: {npc.materialMode === "matte" ? "MATTE" : "ORIGINAL"}</div>
      <div className="mt-0.5 flex flex-wrap gap-1">
        {button("original", "ORIGINAL MATERIALS")}
        {button("matte", "MATTE MATERIALS")}
      </div>
      {r ? (
        <div data-testid="troll-material-params">
          <div>
            {r.type} · metalness {num(r.metalness)} · roughness {num(r.roughness)} · mapa chropowatości: {r.roughnessMap}
          </div>
          <div>
            mapa metaliczności {r.metalnessMap ? "tak" : "nie"} · normalne {r.normalMap ? `tak (x${num(r.normalScale)})` : "nie"} · env {num(r.envMapIntensity)}
          </div>
          {Object.keys(r.physical).length > 0 && <div>{Object.entries(r.physical).map(([k, v]) => `${k} ${num(v)}`).join(" · ")}</div>}
          {r.classes && r.share && (
            <div>
              skóra {num(r.classes.skin)} ({pct(r.share.skin)}) · włosy/broda {num(r.classes.hair)} ({pct(r.share.hair)}) · nos {num(r.classes.nose)} ({pct(r.share.nose)}) · oczy{" "}
              {num(r.classes.eye)} ({pct(r.share.eye)}) · dodatki {num(r.classes.accessory)} ({pct(r.share.accessory)})
            </div>
          )}
        </div>
      ) : (
        <div className="text-amber-200">korekta materiału niedostępna: {npc.materialFallback ?? "brak"}</div>
      )}
      {npc.materialFallback && r && <div className="text-amber-200">tryb zapasowy (jednolita chropowatość): {npc.materialFallback}</div>}
      <div>przygotowanie {npc.materialBakeMs.toFixed(0)} ms · {npc.materials} materiał · bez dodatkowych draw calls</div>
    </div>
  );
}
