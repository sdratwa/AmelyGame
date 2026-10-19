import { describe, expect, it } from "vitest";
import { ambientMix, birdActivity, birdLoudness, phaseOf } from "./mix";

describe("pory dnia", () => {
  it("granice pór dnia", () => {
    expect(phaseOf(4.99)).toBe("noc");
    expect(phaseOf(5)).toBe("świt");
    expect(phaseOf(7.99)).toBe("świt");
    expect(phaseOf(8)).toBe("dzień");
    expect(phaseOf(17.99)).toBe("dzień");
    expect(phaseOf(18)).toBe("zmierzch");
    expect(phaseOf(20.99)).toBe("zmierzch");
    expect(phaseOf(21)).toBe("noc");
    expect(phaseOf(0)).toBe("noc");
    expect(phaseOf(24)).toBe("noc");
  });
});

describe("miks teł", () => {
  it("w dzień gra tylko dzienne tło, w nocy tylko nocne", () => {
    for (const h of [8, 9, 12, 17.9]) expect(ambientMix(h)).toMatchObject({ day: 1, night: 0 });
    for (const h of [21, 22, 0, 2, 4.9]) expect(ambientMix(h)).toMatchObject({ day: 0, night: 1 });
  });

  it("świt stopniowo ścisza noc i wzmacnia dzień; zmierzch odwrotnie", () => {
    let prevDay = -1;
    let prevNight = 2;
    for (let h = 5; h <= 8; h += 0.05) {
      const m = ambientMix(h);
      expect(m.day).toBeGreaterThanOrEqual(prevDay - 1e-9);
      expect(m.night).toBeLessThanOrEqual(prevNight + 1e-9);
      prevDay = m.day;
      prevNight = m.night;
    }
    let d = 2;
    let n = -1;
    for (let h = 18; h <= 21; h += 0.05) {
      const m = ambientMix(h);
      expect(m.day).toBeLessThanOrEqual(d + 1e-9);
      expect(m.night).toBeGreaterThanOrEqual(n - 1e-9);
      d = m.day;
      n = m.night;
    }
  });

  it("crossfade ma stałą moc i nigdy oba tła nie grają na pełnej głośności", () => {
    for (let h = 0; h < 24; h += 0.01) {
      const m = ambientMix(h);
      expect(m.day * m.day + m.night * m.night).toBeCloseTo(1, 5);
      expect(m.day >= 0.999 && m.night >= 0.999).toBe(false);
    }
    expect(ambientMix(6.5).day).toBeGreaterThan(0.3);
    expect(ambientMix(6.5).night).toBeGreaterThan(0.3);
  });

  it("jest ciągły: brak skoków głośności między sąsiednimi minutami", () => {
    let prev = ambientMix(0);
    for (let h = 1 / 60; h < 24; h += 1 / 60) {
      const m = ambientMix(h);
      expect(Math.abs(m.day - prev.day)).toBeLessThan(0.02);
      expect(Math.abs(m.night - prev.night)).toBeLessThan(0.02);
      prev = m;
    }
  });
});

describe("aktywność ptaków", () => {
  it("w nocy brak dziennych ptaków", () => {
    for (const h of [21, 22, 23.5, 0, 1, 3, 4.9]) expect(birdActivity(h)).toBe(0);
  });

  it("rano rośnie i jest większa niż w południe, wieczorem słabnie do zera", () => {
    expect(birdActivity(5.5)).toBeGreaterThan(0);
    expect(birdActivity(7)).toBeGreaterThan(birdActivity(12));
    expect(birdActivity(12)).toBe(1);
    expect(birdActivity(19.5)).toBeLessThan(birdActivity(17));
    expect(birdActivity(20.9)).toBeLessThan(0.05);
  });

  it("głośność pojedynczych ptaków jest ograniczona", () => {
    for (let h = 0; h < 24; h += 0.5) {
      expect(birdLoudness(h)).toBeGreaterThanOrEqual(0.7);
      expect(birdLoudness(h)).toBeLessThanOrEqual(1);
    }
  });
});
