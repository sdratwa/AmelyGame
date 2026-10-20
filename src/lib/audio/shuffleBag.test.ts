import { describe, expect, it } from "vitest";
import { forkRng, ShuffleBag } from "./shuffleBag";
import { mulberry32 } from "./testkit";

describe("ShuffleBag", () => {
  it("każda wartość pada raz na rundę", () => {
    const bag = new ShuffleBag(4, mulberry32(1));
    for (let round = 0; round < 50; round++) {
      const got = Array.from({ length: 4 }, () => bag.next());
      expect([...got].sort()).toEqual([0, 1, 2, 3]);
    }
    expect(bag.roundsStarted).toBe(50);
  });

  it("nigdy nie powtarza tej samej wartości pod rząd, także na granicy rund, dla wielu ziaren", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const bag = new ShuffleBag(4, mulberry32(seed));
      let prev = -1;
      for (let i = 0; i < 200; i++) {
        const v = bag.next();
        expect(v).not.toBe(prev);
        prev = v;
      }
    }
  });

  it("kolejność nie jest stała i pierwsza wartość zależy od losowania", () => {
    const orders = new Set<string>();
    const firsts = new Set<number>();
    for (let seed = 1; seed <= 60; seed++) {
      const bag = new ShuffleBag(4, mulberry32(seed));
      const run = Array.from({ length: 4 }, () => bag.next());
      orders.add(run.join(","));
      firsts.add(run[0]);
    }
    expect(orders.size).toBeGreaterThan(8);
    expect(firsts.size).toBe(4);
  });

  it("rozkład jest równomierny w długim przebiegu", () => {
    const bag = new ShuffleBag(4, mulberry32(7));
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < 4000; i++) counts[bag.next()]++;
    for (const c of counts) expect(c).toBe(1000);
  });

  it("pojedyncza wartość działa (brak pętli nieskończonej), zły rozmiar jest odrzucany", () => {
    const one = new ShuffleBag(1, mulberry32(1));
    expect([one.next(), one.next(), one.next()]).toEqual([0, 0, 0]);
    expect(() => new ShuffleBag(0, mulberry32(1))).toThrow();
  });

  it("worki są niezależne: losowanie jednego nie zmienia drugiego", () => {
    const a1 = new ShuffleBag(4, mulberry32(5));
    const seq1 = Array.from({ length: 40 }, () => a1.next());
    const a2 = new ShuffleBag(4, mulberry32(5));
    const b = new ShuffleBag(4, mulberry32(6));
    const seq2: number[] = [];
    for (let i = 0; i < 40; i++) {
      b.next();
      seq2.push(a2.next());
    }
    expect(seq2).toEqual(seq1);
  });
});

describe("forkRng", () => {
  it("daje strumień niezależny od generatora bazowego po rozwidleniu", () => {
    const base1 = mulberry32(9);
    const fork1 = forkRng(base1);
    const base2 = mulberry32(9);
    const fork2 = forkRng(base2);
    for (let i = 0; i < 100; i++) base2();
    expect(Array.from({ length: 20 }, fork2)).toEqual(Array.from({ length: 20 }, fork1));
  });

  it("dwa kolejne rozwidlenia dają różne strumienie w zakresie [0, 1)", () => {
    const base = mulberry32(2);
    const a = forkRng(base);
    const b = forkRng(base);
    const sa = Array.from({ length: 20 }, a);
    const sb = Array.from({ length: 20 }, b);
    expect(sa).not.toEqual(sb);
    for (const v of [...sa, ...sb]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
