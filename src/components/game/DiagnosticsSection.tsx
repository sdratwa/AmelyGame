"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { DIAG_SECTIONS, diagSectionsStore, type DiagSectionId } from "@/lib/forest-view/diagSections";
import { cn } from "@/lib/utils";

/**
 * Zwijana sekcja panelu Diagnostyka. Nagłówek jest zawsze widoczny i klikalny; treść znika po zwinięciu, więc długie
 * sekcje (np. troll, wygląd) nie wypychają z ekranu parametrów lampy. Stan jest lokalny i zapamiętywany w przeglądarce.
 */
export function DiagSection({ id, summary, children }: { id: DiagSectionId; summary?: ReactNode; children: ReactNode }) {
  const store = diagSectionsStore();
  useSyncExternalStore(store.subscribe, () => store.revision, () => 0);
  const def = DIAG_SECTIONS.find((s) => s.id === id)!;
  const open = store.isOpen(id, def.defaultOpen);
  return (
    <section data-testid={`diag-section-${id}`} data-open={open} className="mt-1 border-t border-white/20 pt-1 first:mt-0 first:border-t-0 first:pt-0">
      <button
        type="button"
        data-testid={`diag-toggle-${id}`}
        aria-expanded={open}
        onClick={(e) => {
          store.toggle(id, def.defaultOpen);
          e.currentTarget.blur();
        }}
        className="pointer-events-auto flex w-full items-center gap-1 rounded text-left font-semibold text-amber-200 hover:bg-white/10"
      >
        <span aria-hidden className="w-3 shrink-0 text-center">
          {open ? "▾" : "▸"}
        </span>
        <span>{def.title}</span>
        {summary ? <span className="min-w-0 truncate font-normal text-slate-400">· {summary}</span> : null}
      </button>
      {open && <div className={cn("mt-0.5 pl-1", "[&>div]:mt-0 [&>div]:border-t-0 [&>div]:pt-0")}>{children}</div>}
    </section>
  );
}

/** Przyciski "Zwiń wszystko / Rozwiń wszystko" na górze panelu Diagnostyka. */
export function DiagSectionsToolbar() {
  const store = diagSectionsStore();
  useSyncExternalStore(store.subscribe, () => store.revision, () => 0);
  const btn = "pointer-events-auto rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-semibold text-slate-100 hover:bg-white/25";
  return (
    <div className="mb-1 flex items-center gap-1" data-testid="diag-toolbar">
      <span className="font-semibold text-slate-300">Sekcje:</span>
      <button type="button" data-testid="diag-collapse-all" className={btn} onClick={(e) => { store.setAll(false); e.currentTarget.blur(); }}>
        Zwiń wszystkie
      </button>
      <button type="button" data-testid="diag-expand-all" className={btn} onClick={(e) => { store.setAll(true); e.currentTarget.blur(); }}>
        Rozwiń wszystkie
      </button>
    </div>
  );
}
