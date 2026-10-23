import { describe, expect, it } from "vitest";
import { movementDiagRows } from "./movementDiagnostics";
import { DIAG_SECTIONS } from "@/lib/forest-view/diagSections";

const base = { y: 0.8, vy: 0, grounded: true, support: null, rockId: null, lastBlock: null, lastLanding: null, landingCandidate: null };
const value = (rows: ReturnType<typeof movementDiagRows>, label: string) => rows.find((r) => r.label === label)?.value;

describe("diagnostyka ruchu i podparcia", () => {
  it("na skale: wysokość stóp, stan, rodzaj i wysokość powierzchni, id skały, ostatnie lądowanie", () => {
    const rows = movementDiagRows({
      ...base,
      support: { kind: "rock", id: "rock.forest_start.1_0.2", y: 0.8 },
      rockId: "rock.forest_start.1_0.2",
      lastLanding: { kind: "rock", id: "rock.forest_start.1_0.2", y: 0.8, impact: 5.2 },
    });
    expect(value(rows, "Stopy Y")).toBe("0.80");
    expect(value(rows, "Stan")).toBe("na ziemi");
    expect(value(rows, "Podparcie")).toBe("skała rock.forest_start.1_0.2, Y 0.80");
    expect(value(rows, "Skała")).toBe("rock.forest_start.1_0.2");
    expect(value(rows, "Ost. lądowanie")).toContain("uderzenie 5.20 m/s");
    expect(value(rows, "Potenc. lądowanie")).toBe("-");
  });

  it("w powietrzu: Vy, brak podparcia, ostatnia blokada i potencjalne lądowanie (teren, most albo skała)", () => {
    const rows = movementDiagRows({ ...base, y: 1.2, vy: -3.456, grounded: false, lastBlock: "object:rock.x", landingCandidate: { kind: "bridge", id: null, y: 0.4 } });
    expect(value(rows, "Stan")).toBe("w powietrzu");
    expect(value(rows, "Vy")).toBe("-3.46 m/s");
    expect(value(rows, "Podparcie")).toBe("-");
    expect(value(rows, "Ost. blokada")).toBe("object:rock.x");
    expect(value(rows, "Potenc. lądowanie")).toBe("most, Y 0.40");
  });

  it("sekcja Diagnostyki 'Ruch i podparcie' jest zarejestrowana i domyślnie zwinięta", () => {
    expect(DIAG_SECTIONS.find((s) => s.id === "movement")).toMatchObject({ defaultOpen: false });
  });
});
