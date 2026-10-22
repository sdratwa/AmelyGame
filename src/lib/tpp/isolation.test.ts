import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const dir = path.join(process.cwd(), "src/lib/tpp");
const sources = fs.readdirSync(dir).filter((f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f) && f !== "testkit.ts");
const importsOf = (file: string) => [...fs.readFileSync(path.join(dir, file), "utf8").matchAll(/from "([^"]+)"/g)].map((m) => m[1]);

describe("TPP: logika jest oddzielona od renderera i od silnika gry", () => {
  it("src/lib/tpp nie importuje Three.js, React ani silnika gry, zapisu, questów i treści", () => {
    expect(sources.length).toBeGreaterThan(6);
    const forbidden = /^(three|react|@react-three\/.*)(\/.*)?$|^@\/lib\/game\/(engine|core|save|systems|content|quest)/;
    for (const file of sources) {
      for (const source of importsOf(file)) expect(forbidden.test(source), `${file} importuje ${source}`).toBe(false);
    }
  });

  it("w kodzie nie ma niezależnych liczb prędkości: wartości domyślne są tylko w config.ts", () => {
    for (const file of sources.filter((f) => f !== "config.ts")) {
      const text = fs.readFileSync(path.join(dir, file), "utf8");
      expect(/\b(2\.2|4\.8)\b/.test(text), `${file} zawiera stałą prędkość`).toBe(false);
    }
  });
});
