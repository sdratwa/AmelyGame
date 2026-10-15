import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalize, fingerprintOf, hashHex } from "./fingerprint";
import { CURRENT_GEN_VERSION, fingerprintWorld, generateWorld, hasGenerator } from "./registry";

describe("generator świata", () => {
  it("ten sam seed daje identyczne obiekty", () => {
    for (const seed of [0, 1, 2030, 0xffff_ffff, 123456789]) {
      const a = generateWorld(seed);
      const b = generateWorld(seed);
      expect(a).toEqual(b);
      expect(fingerprintWorld(a)).toBe(fingerprintWorld(b));
    }
  });

  it("różne seedy dają różne światy", () => {
    const prints = new Set<string>();
    for (let seed = 1; seed <= 50; seed++) prints.add(fingerprintWorld(generateWorld(seed)));
    expect(prints.size).toBe(50);
  });

  it("domy z seeda są poprawne: cena, telefon, unikalne id", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const { houses } = generateWorld(seed);
      expect(houses).toHaveLength(2);
      expect(new Set(houses.map((h) => h.id)).size).toBe(houses.length);
      for (const h of houses) {
        expect(h.price).toBeGreaterThanOrEqual(200_000);
        expect(h.price).toBeLessThanOrEqual(500_000);
        expect(h.phone).toMatch(/^\d{6}$/);
        expect(h.owned).toBe(false);
      }
    }
  });

  it("generator v1 jest zamrożony: złoty odcisk dla znanych seedów", () => {
    expect(fingerprintWorld(generateWorld(2030, 1))).toBe("fp1:0422d62d9a3b82");
    expect(generateWorld(2030, 1).houses[0]).toMatchInlineSnapshot(`
      {
        "doorColor": "#5b3a22",
        "flip": true,
        "id": "dom-1",
        "level": 4,
        "name": "ul. Leśna 16",
        "owned": false,
        "phone": "953438",
        "price": 451000,
        "roofColor": "#c97a3a",
        "wallColor": "#cbbfa8",
      }
    `);
  });

  it("nieznana wersja generatora jest odrzucana", () => {
    expect(hasGenerator(CURRENT_GEN_VERSION)).toBe(true);
    expect(hasGenerator(999)).toBe(false);
    expect(() => generateWorld(1, 999)).toThrow();
  });
});

describe("odcisk", () => {
  it("kanonizacja nie zależy od kolejności kluczy", () => {
    expect(canonicalize({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(canonicalize({ a: [2, { c: 2, d: 1 }], b: 1 }));
    expect(fingerprintOf({ a: 1, b: 2 })).toBe(fingerprintOf({ b: 2, a: 1 }));
  });
  it("hash ma stały format i reaguje na zmianę", () => {
    expect(hashHex("a")).toMatch(/^[0-9a-f]{14}$/);
    expect(hashHex("a")).not.toBe(hashHex("b"));
  });
});

const GAME_DIR = join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("determinizm kodu gry", () => {
  it("logika gry nie używa Math.random ani zegara systemowego", () => {
    const offenders = sourceFiles(GAME_DIR)
      .filter((file) => /Math\.random|Date\.now|new Date\(|performance\.now/.test(readFileSync(file, "utf8")))
      .map((file) => relative(GAME_DIR, file));
    expect(offenders).toEqual([]);
  });

  it("pliki generatora v1 nie zostały zmienione (FROZEN.sha256)", () => {
    const dir = join(__dirname, "generators", "v1");
    const lines = readFileSync(join(dir, "FROZEN.sha256"), "utf8").trim().split("\n");
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const [expected, file] = line.split(/\s+/);
      const text = readFileSync(join(dir, "..", file), "utf8").replace(/\r\n/g, "\n");
      expect(createHash("sha256").update(text).digest("hex"), file).toBe(expected);
    }
  });
});
