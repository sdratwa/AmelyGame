import { describe, expect, it } from "vitest";
import { DIAG_SECTIONS, DIAG_SECTIONS_KEY, DiagSectionsStore } from "./diagSections";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  };
}

describe("DiagSectionsStore", () => {
  it("używa ustawień domyślnych, dopóki użytkownik niczego nie zmieni", () => {
    const store = new DiagSectionsStore(memoryStorage());
    for (const s of DIAG_SECTIONS) expect(store.isOpen(s.id, s.defaultOpen)).toBe(s.defaultOpen);
  });

  it("lampa jest domyślnie rozwinięta, a pozostałe ciężkie sekcje zwinięte", () => {
    const open = DIAG_SECTIONS.filter((s) => s.defaultOpen).map((s) => s.id);
    expect(open).toContain("lantern");
    expect(DIAG_SECTIONS.find((s) => s.id === "npc")?.defaultOpen).toBe(false);
  });

  it("przełącza pojedynczą sekcję, zapamiętuje wybór i powiadamia słuchaczy", () => {
    const storage = memoryStorage();
    const store = new DiagSectionsStore(storage);
    let calls = 0;
    store.subscribe(() => calls++);
    store.toggle("npc", false);
    expect(store.isOpen("npc", false)).toBe(true);
    expect(calls).toBe(1);
    expect(store.revision).toBe(1);
    expect(JSON.parse(storage.data[DIAG_SECTIONS_KEY])).toEqual({ npc: true });
    expect(new DiagSectionsStore(storage).isOpen("npc", false)).toBe(true);
  });

  it("zwija i rozwija wszystkie sekcje naraz", () => {
    const store = new DiagSectionsStore(memoryStorage());
    store.setAll(false);
    for (const s of DIAG_SECTIONS) expect(store.isOpen(s.id, true)).toBe(false);
    store.setAll(true);
    for (const s of DIAG_SECTIONS) expect(store.isOpen(s.id, false)).toBe(true);
  });

  it("ignoruje uszkodzony lub obcy zapis i działa bez localStorage", () => {
    expect(new DiagSectionsStore(memoryStorage({ [DIAG_SECTIONS_KEY]: "{nie-json" })).isOpen("perf", true)).toBe(true);
    expect(new DiagSectionsStore(memoryStorage({ [DIAG_SECTIONS_KEY]: '{"perf":"tak","npc":true}' })).isOpen("perf", true)).toBe(true);
    const bare = new DiagSectionsStore(null);
    bare.set("deer", true);
    expect(bare.isOpen("deer", false)).toBe(true);
  });
});
