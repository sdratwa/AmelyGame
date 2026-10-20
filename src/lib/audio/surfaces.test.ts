import { describe, expect, it } from "vitest";
import { DEFAULT_SURFACE, FOOTSTEP_POOLS, poolSamples, SURFACE_PROFILES, surfaceFromWorld, type SurfaceId } from "./surfaces";

describe("profile nawierzchni kroków", () => {
  it("każdy profil wskazuje istniejącą pulę, a pula to cztery dostarczone próbki", () => {
    for (const p of Object.values(SURFACE_PROFILES)) {
      expect(FOOTSTEP_POOLS[p.pool], p.id).toBeTruthy();
      expect(p.gain).toBeGreaterThan(0.5);
      expect(p.gain).toBeLessThan(1.5);
    }
    expect(poolSamples("litter")).toEqual(["footsteps.light.1", "footsteps.light.2", "footsteps.light.3", "footsteps.light.4"]);
    expect(SURFACE_PROFILES[DEFAULT_SURFACE]).toBeTruthy();
  });

  it("wszystkie nawierzchnie dzielą dziś wspólną pulę (próbki to warianty jednego kroku, nie różne materiały)", () => {
    const pools = new Set((Object.keys(SURFACE_PROFILES) as SurfaceId[]).map((id) => SURFACE_PROFILES[id].pool));
    expect(pools.size).toBe(1);
  });

  it("rozpoznaje ścieżkę, trawę (polana, brzeg rzeki) i ściółkę; skały i most są oznaczone jako niewykrywane", () => {
    expect(surfaceFromWorld({ surface: "path", profile: "deep" })).toBe("path");
    expect(surfaceFromWorld({ surface: "ground", profile: "clearing" })).toBe("grass");
    expect(surfaceFromWorld({ surface: "ground", profile: "riverside" })).toBe("grass");
    expect(surfaceFromWorld({ surface: "ground", profile: "deep" })).toBe("litter");
    expect(surfaceFromWorld({ surface: "water", profile: "deep" })).toBe("litter");
    expect(SURFACE_PROFILES.rock.detected).toBe(false);
    expect(SURFACE_PROFILES.wood.detected).toBe(false);
    expect(SURFACE_PROFILES.path.detected && SURFACE_PROFILES.grass.detected && SURFACE_PROFILES.litter.detected).toBe(true);
  });
});
