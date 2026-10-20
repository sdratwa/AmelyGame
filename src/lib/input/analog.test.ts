import { describe, expect, it } from "vitest";
import { LOOK_YAW_RATE, mergeMove, shapeLook, shapeMove, shapeStick, yawRate } from "./analog";

const v = () => ({ x: 0, y: 0 });

describe("deadzone radialny", () => {
  it("puszczony analog (dryf poniżej deadzone) daje zero", () => {
    const out = v();
    expect(shapeStick(0.1, -0.1, 0.15, 1, out)).toBe(0);
    expect(out).toEqual({ x: 0, y: 0 });
  });

  it("deadzone jest radialny: ten sam dryf po przekątnej też jest wycinany", () => {
    const out = v();
    // długość 0.14 < 0.15, mimo że żadna oś osobno nie jest duża
    expect(shapeStick(0.099, 0.099, 0.15, 1, out)).toBe(0);
  });

  it("pełne wychylenie daje 1, a skala startuje od zera za deadzone", () => {
    const out = v();
    expect(shapeStick(1, 0, 0.15, 1, out)).toBeCloseTo(1, 6);
    const small = shapeStick(0.16, 0, 0.15, 1, v());
    expect(small).toBeGreaterThan(0);
    expect(small).toBeLessThan(0.05);
  });

  it("zachowuje kierunek wektora", () => {
    const out = v();
    shapeStick(0.6, 0.3, 0.15, 1, out);
    expect(out.y / out.x).toBeCloseTo(0.5, 6);
  });

  it("przekątna nie jest szybsza niż pełne wychylenie w jedną stronę", () => {
    const out = v();
    const m = shapeStick(1, 1, 0.15, 1.35, out);
    expect(m).toBeLessThanOrEqual(1 + 1e-9);
    expect(Math.hypot(out.x, out.y)).toBeLessThanOrEqual(1 + 1e-9);
  });

  it("wartości spoza zakresu są ograniczane", () => {
    const out = v();
    expect(shapeStick(3, 4, 0.15, 1.35, out)).toBeLessThanOrEqual(1 + 1e-9);
  });
});

describe("krzywa reakcji", () => {
  it("jest monotoniczna i lekko nieliniowa (małe wychylenie = wolniej niż liniowo)", () => {
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
      const raw = i / 20;
      const m = shapeStick(raw, 0, 0.15, 1.35, v());
      expect(m).toBeGreaterThanOrEqual(prev);
      prev = m;
    }
    const linear = shapeStick(0.5, 0, 0.15, 1, v());
    const curved = shapeStick(0.5, 0, 0.15, 1.35, v());
    expect(curved).toBeLessThan(linear);
  });
});

describe("ruch postaci", () => {
  it("analog w górę (oś -1) = do przodu (+y)", () => {
    const out = v();
    shapeMove(0, -1, 0.15, out);
    expect(out.y).toBeCloseTo(1, 6);
    expect(out.x).toBe(0);
  });

  it("małe wychylenie = powolne chodzenie, duże = prawie pełne", () => {
    const small = v();
    const big = v();
    shapeMove(0, -0.3, 0.15, small);
    shapeMove(0, -1, 0.15, big);
    expect(small.y).toBeLessThan(0.3);
    expect(big.y).toBeGreaterThan(0.99);
  });

  it("brak samoczynnego chodzenia przy puszczonym analogu", () => {
    const out = v();
    shapeMove(0.05, -0.08, 0.15, out);
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
  });
});

describe("kamera", () => {
  it("odwrócenie osi Y zmienia znak ruchu pionowego", () => {
    const a = v();
    const b = v();
    shapeLook(0, 0.8, 0.15, false, a);
    shapeLook(0, 0.8, 0.15, true, b);
    expect(a.y).toBeGreaterThan(0);
    expect(b.y).toBeCloseTo(-a.y, 9);
  });

  it("czułość skaluje prędkość obrotu", () => {
    expect(yawRate(2)).toBeCloseTo(LOOK_YAW_RATE * 2, 9);
  });

  it("deadzone prawego analoga eliminuje dryf", () => {
    const out = v();
    shapeLook(0.1, 0.1, 0.15, false, out);
    expect(out).toEqual({ x: 0, y: 0 });
  });
});

describe("łączenie klawiatury i pada", () => {
  const out = () => ({ forward: 0, right: 0, sprint: false });

  it("klawiatura ma pierwszeństwo i wejścia nie sumują się", () => {
    const r = mergeMove(1, 0, false, 0.7, 0.7, false, false, out());
    expect(r.forward).toBe(1);
    expect(r.right).toBe(0);
  });

  it("bez klawiszy ruch pochodzi z pada", () => {
    const r = mergeMove(0, 0, false, 0.3, 0.6, false, false, out());
    expect(r.right).toBe(0.3);
    expect(r.forward).toBe(0.6);
  });

  it("L3 bez wychylenia nie uruchamia biegu", () => {
    expect(mergeMove(0, 0, false, 0, 0, true, false, out()).sprint).toBe(false);
    expect(mergeMove(0, 0, false, 0, 0.8, true, false, out()).sprint).toBe(true);
  });

  it("zawieszenie (dialog, okno) zeruje ruch z obu źródeł", () => {
    const r = mergeMove(1, 1, true, 1, 1, true, true, out());
    expect(r).toEqual({ forward: 0, right: 0, sprint: false });
  });
});
