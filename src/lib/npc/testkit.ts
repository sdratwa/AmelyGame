import { parseWithoutTextures, publicDir, readJsonFile } from "@/lib/assets/glbTestkit";
import { loadTrollAsset, type TrollAsset } from "@/lib/assets/characters";

/** Troll wczytany z `public/characters` bez tekstur (patrz `glbTestkit`): szkielet, skóra i animacje są prawdziwe. */
export const loadTestTroll = (): Promise<TrollAsset> =>
  loadTrollAsset({
    loadJson: async (url) => readJsonFile(publicDir(url.replace(/^\//, ""))),
    loadGlb: (url) => parseWithoutTextures(publicDir(url.replace(/^\//, ""))),
  });
