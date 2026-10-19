import { describe, expect, it } from "vitest";
import { detectSteps } from "./onsets";

const SR = 8000;

function thump(buffer: Float32Array, at: number, seconds = 0.12, amp = 0.8) {
  const start = Math.round(at * SR);
  const n = Math.round(seconds * SR);
  for (let i = 0; i < n && start + i < buffer.length; i++) {
    const env = Math.exp((-6 * i) / n);
    buffer[start + i] += amp * env * Math.sin(i * 0.9) * (i % 3 === 0 ? 1 : 0.7);
  }
}

describe("detectSteps", () => {
  it("jedno uderzenie to pojedynczy krok", () => {
    const x = new Float32Array(SR * 1);
    thump(x, 0.2);
    const r = detectSteps(x, SR);
    expect(r.kind).toBe("single");
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0].start).toBeLessThan(0.2);
    expect(r.segments[0].end).toBeGreaterThan(0.22);
  });

  it("kilka uderzeń to sekwencja z jednym segmentem na krok", () => {
    const x = new Float32Array(SR * 4);
    const at = [0.3, 0.95, 1.6, 2.3, 2.9];
    for (const t of at) thump(x, t, 0.12, 0.6 + 0.1 * (t % 2));
    const r = detectSteps(x, SR);
    expect(r.kind).toBe("sequence");
    expect(r.segments).toHaveLength(at.length);
    r.segments.forEach((s, i) => {
      expect(s.start).toBeLessThanOrEqual(at[i]);
      expect(s.end).toBeGreaterThan(at[i]);
      if (i > 0) expect(s.start).toBeGreaterThanOrEqual(r.segments[i - 1].end - 1e-6);
    });
  });

  it("cisza nie daje segmentów", () => {
    expect(detectSteps(new Float32Array(SR), SR)).toEqual({ kind: "silent", segments: [] });
  });
});
