import { describe, expect, it } from "vitest";
import { hashString, mulberry32, rngStream, streamSeed } from "./rng";

describe("rng", () => {
  it("mulberry32 jest bitowo stabilny (kontrakt zgodności zapisów)", () => {
    const r = mulberry32(2030);
    expect([r(), r(), r(), r()]).toEqual([
      0.9332865253090858, 0.8923139779362828, 0.7017602070700377,
      0.03565200068987906,
    ]);
  });

  it("hashString i streamSeed są stabilne", () => {
    expect(hashString("miasto")).toBe(3794606442);
    expect(streamSeed(2030, "river")).toBe(554298908);
    expect(streamSeed(2030, "chests")).toBe(1230379944);
  });

  it("to samo ziarno i klucz dają ten sam ciąg", () => {
    const a = rngStream(7, "trees");
    const b = rngStream(7, "trees");
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("strumienie o różnych kluczach i ziarnach są niezależne", () => {
    const first = (seed: number, key: string) => rngStream(seed, key)();
    expect(first(7, "trees")).not.toBe(first(7, "rocks"));
    expect(first(7, "trees")).not.toBe(first(8, "trees"));
  });

  it("wartości mieszczą się w [0, 1)", () => {
    const r = rngStream(1, "range");
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
