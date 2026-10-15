import fs from "node:fs";
import path from "node:path";
import { describe, it } from "vitest";
import { buildForest, createForest, pickShowcaseSectors, summarizeForest } from ".";

const enabled = process.env.FOREST_REPORT === "1";
const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../../../../public/models/manifest.json"), "utf8")) as {
  models: { id: string; triangles: number }[];
};
const triangles = new Map(manifest.models.map((m) => [m.id, m.triangles]));

const ms = (t: number) => `${t.toFixed(1)} ms`;
const median = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1];

/** Raport W1a (liczby do dokumentacji): `npm run world:report`. Bez zmiennej FOREST_REPORT=1 test jest pominięty. */
describe.skipIf(!enabled)("W1a: raport", () => {
  it("drukuje liczby obiektów, gęstości, czasy i sektory", () => {
    const seeds = [1, 2030, 4000000000];
    for (const seed of seeds) {
      const t0 = performance.now();
      const lazy = createForest(seed);
      const tPrepare = performance.now() - t0;
      const t1 = performance.now();
      const sectors = lazy.allSectors();
      const tAll = performance.now() - t1;
      lazy.clearCache();
      const per = sectors.map((_, i) => {
        const t = performance.now();
        lazy.sector(i % 10, Math.floor(i / 10));
        return performance.now() - t;
      });
      const t2 = performance.now();
      const built = buildForest(seed);
      const tBuild = performance.now() - t2;
      const sum = summarizeForest(lazy, triangles);
      const best = pickShowcaseSectors(lazy, 3);
      const lines: string[] = [];
      lines.push(`== seed ${seed} ==`);
      lines.push(`sektory: ${sum.sectors}, obszar ${sum.areaM2} m2, obiekty: ${sum.totalObjects}, z kolizją: ${sum.colliders}`);
      lines.push(`prepare (teren+plan): ${ms(tPrepare)}, wszystkie sektory: ${ms(tAll)}, pojedynczy sektor mediana ${ms(median(per))} max ${ms(Math.max(...per))}`);
      lines.push(`buildForest z walidacją: ${ms(tBuild)}, naruszenia: ${built.world.report.violations.length}`);
      for (const [kind, s] of Object.entries(sum.byKind).sort((a, b) => b[1].total - a[1].total)) {
        lines.push(`  ${kind.padEnd(9)} ${String(s.total).padStart(6)}  ${s.per100m2.toFixed(2).padStart(6)}/100m2  sektor min/med/max ${s.sectorMin}/${s.sectorMedian}/${s.sectorMax}`);
      }
      lines.push(`trójkąty LOD0: świat ${sum.trianglesLod0}, najgęstsze okno 7x7 ${sum.trianglesWorstWindow}`);
      lines.push(`sektory wzorcowe: ${best.map((b) => `${b.id}${b.qualifies ? "" : "?"}`).join(", ")}`);
      console.info(lines.join("\n"));
    }
  }, 180_000);
});
