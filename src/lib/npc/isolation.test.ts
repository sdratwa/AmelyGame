import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NpcLayer, trollPlacement } from "@/lib/forest-view/npc";
import { serializeState } from "@/lib/game/save/serialize";
import { forestOf, forestWalkOf } from "@/lib/game/world/lookup";
import { inForest, newPlaying, run } from "@/lib/game/testkit";
import { loadTestTroll } from "./testkit";

const root = process.cwd();
const files = (dir: string) => fs.readdirSync(path.join(root, dir)).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f)).map((f) => path.join(dir, f));
const imports = (file: string) => [...fs.readFileSync(path.join(root, file), "utf8").matchAll(/from "([^"]+)"/g)].map((m) => m[1]);

describe("test dialogu trolla jest oddzielony od prawdziwej logiki questa", () => {
  it("zachowanie trolla i testowe okno nie importują silnika gry, zapisu, questów ani zawartości (tylko świat i generator liczb losowych)", () => {
    const forbidden = /^@\/lib\/game\/(engine|core\/(apply|state|events|commands)|save|systems|content|quest)/;
    const checked = [...files("src/lib/npc"), "src/lib/forest-view/npc.ts", "src/components/game/TrollTestDialog.tsx"];
    expect(checked.length).toBeGreaterThan(6);
    for (const file of checked) {
      for (const source of imports(file)) expect(forbidden.test(source), `${file} importuje ${source}`).toBe(false);
    }
  });

  it("pełne spotkanie z oboma wynikami dialogu nie zmienia SaveV2, stanu questa, skrzyń ani ekwipunku", async () => {
    const seed = 777;
    const state = Object.freeze(inForest(run(newPlaying(seed), { type: "board.read", id: "quest.bridge_01" }, { type: "quest.accept", id: "quest.bridge_01" })));
    const before = JSON.stringify(serializeState(state, 1));
    const forest = forestOf(seed);
    const layer = new NpcLayer(await loadTestTroll(), { forest, walk: forestWalkOf(seed), seed, castShadow: false, receiveShadow: false });
    let requests = 0;
    layer.onDialog(() => requests++);
    const at = (d: number) => ({ x: layer.troll.x + d, z: layer.troll.z });
    for (const outcome of ["correct", "wrong", "dismissed"] as const) {
      layer.restartEncounter();
      for (let i = 0; i < 60 * 25 && !layer.stats().dialogActive; i++) layer.update(1 / 60, at(3));
      expect(layer.stats().dialogActive, outcome).toBe(true);
      expect(layer.resolveDialog(outcome)).toBe(true);
      for (let i = 0; i < 60 * 25; i++) layer.update(1 / 60, at(3));
    }
    expect(requests).toBe(3);
    expect(JSON.stringify(serializeState(state, 1))).toBe(before);
    const save = serializeState(state, 1)!;
    expect(Object.keys(save.troll).sort()).toEqual(["attempts", "deposit", "lockUntil", "phase"]);
    expect(save.troll.phase).toBe(state.troll.phase);
    expect(trollPlacement(forest).home).toBeDefined();
    layer.dispose();
  }, 30_000);

  it("zapis nie zawiera śladu testowego spotkania", () => {
    const state = inForest(newPlaying(5));
    const text = JSON.stringify(serializeState(state, 1)).toLowerCase();
    for (const word of ["surprised", "dance", "happy", "nervous", "encounter", "dialog_test", "troll_test"]) expect(text, word).not.toContain(word);
  });
});
