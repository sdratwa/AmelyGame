import { describe, expect, it } from "vitest";
import { drawerReducer, isInventoryEmpty } from "./inventoryDrawer";

describe("drawerReducer", () => {
  it("domyślnie schowany; przycisk otwiera mini i zamyka", () => {
    expect(drawerReducer("closed", "toggle")).toBe("mini");
    expect(drawerReducer("mini", "toggle")).toBe("closed");
    expect(drawerReducer("expanded", "toggle")).toBe("closed");
  });

  it("rozwijanie działa tylko z otwartego panelu", () => {
    expect(drawerReducer("closed", "toggleExpand")).toBe("closed");
    expect(drawerReducer("mini", "toggleExpand")).toBe("expanded");
    expect(drawerReducer("expanded", "toggleExpand")).toBe("mini");
  });

  it("close zawsze chowa panel", () => {
    for (const m of ["closed", "mini", "expanded"] as const) expect(drawerReducer(m, "close")).toBe("closed");
  });
});

describe("isInventoryEmpty", () => {
  it("wykrywa pusty i niepusty ekwipunek", () => {
    expect(isInventoryEmpty([null, undefined, null])).toBe(true);
    expect(isInventoryEmpty([])).toBe(true);
    expect(isInventoryEmpty([null, { id: "item.pickaxe", count: 1 }])).toBe(false);
  });
});
