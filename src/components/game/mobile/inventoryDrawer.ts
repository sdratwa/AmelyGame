/** Stan wysuwanego plecaka na telefonie: schowany, mini (jeden rząd slotów) i rozwinięty. Czysta logika bez Reacta. */

export type DrawerMode = "closed" | "mini" | "expanded";
export type DrawerAction = "toggle" | "close" | "toggleExpand";

export function drawerReducer(mode: DrawerMode, action: DrawerAction): DrawerMode {
  switch (action) {
    case "toggle":
      return mode === "closed" ? "mini" : "closed";
    case "close":
      return "closed";
    case "toggleExpand":
      if (mode === "closed") return mode;
      return mode === "mini" ? "expanded" : "mini";
  }
}

/** Ekwipunek bez żadnego przedmiotu: panel pokazuje jedną linię zamiast rzędu pustych slotów. */
export function isInventoryEmpty(slots: readonly (unknown | null | undefined)[]): boolean {
  return slots.every((s) => !s);
}
