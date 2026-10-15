import type { Season } from "@/lib/game/engine";

export type Palette = {
  edge: string;
  grassLight: string;
  grassMid: string;
  grassDark: string;
  canopy: string[];
  trunk: string;
  flowers: string[];
  rock: [string, string, string];
  snow: boolean;
  cobbleBase: string;
  cobbleStones: string[];
};

export const PALETTES: Record<Season, Palette> = {
  autumn: {
    edge: "#10130d",
    grassLight: "#9a9a4a",
    grassMid: "#7a8040",
    grassDark: "#4f5a2c",
    canopy: ["#c8651b", "#e0a02f", "#7a8f3a", "#4f7a36", "#a8441e"],
    trunk: "#4a3322",
    flowers: ["#e8a33d", "#d9602b", "#f2d06b", "#c24a2a"],
    rock: ["#6a665d", "#46433d", "#2c2a27"],
    snow: false,
    cobbleBase: "#4a463d",
    cobbleStones: ["#a89f88", "#9a917b", "#b5ac94", "#8c8470"],
  },
  summer: {
    edge: "#0b140c",
    grassLight: "#6fb04a",
    grassMid: "#4e9440",
    grassDark: "#2f6a30",
    canopy: ["#2f7a3a", "#3f9448", "#25622f", "#4aa650", "#5cb85a"],
    trunk: "#4a3322",
    flowers: ["#f2d06b", "#ffffff", "#e86a8a", "#8a7ae8"],
    rock: ["#76736a", "#4c4a44", "#2e2c29"],
    snow: false,
    cobbleBase: "#4d4a42",
    cobbleStones: ["#b3ab96", "#a39b85", "#c0b8a0", "#938b76"],
  },
  spring: {
    edge: "#0e170f",
    grassLight: "#8ccf62",
    grassMid: "#68b44f",
    grassDark: "#3f8a3a",
    canopy: ["#6fbf5a", "#8fd46f", "#f0a8c0", "#58a84a", "#f7c9d8"],
    trunk: "#5a3d2a",
    flowers: ["#ffffff", "#f6a5c0", "#f7e06b", "#b49af0"],
    rock: ["#7a776e", "#504e48", "#302e2b"],
    snow: false,
    cobbleBase: "#4d4a42",
    cobbleStones: ["#b8b09b", "#a8a08a", "#c5bda5", "#98907b"],
  },
  winter: {
    edge: "#0a1018",
    grassLight: "#eef4fa",
    grassMid: "#d3e0ec",
    grassDark: "#a9bccd",
    canopy: ["#33594a", "#2a4a40", "#3f6a5a", "#4a7566"],
    trunk: "#4a3a2e",
    flowers: ["#c24a2a", "#ffffff", "#8aa4c8", "#e8d9a0"],
    rock: ["#6f747a", "#474b51", "#2b2e33"],
    snow: true,
    cobbleBase: "#5a5f66",
    cobbleStones: ["#b8bec5", "#a9afb8", "#c8cdd3", "#9aa1ab"],
  },
};

function parse(hex: string): [number, number, number] {
  if (hex.startsWith("rgb")) {
    const m = hex.match(/\d+/g) ?? ["0", "0", "0"];
    return [Number(m[0]), Number(m[1]), Number(m[2])];
  }
  const h = hex.replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [
    parseInt(v.slice(0, 2), 16),
    parseInt(v.slice(2, 4), 16),
    parseInt(v.slice(4, 6), 16),
  ];
}

/** factor < 1 przyciemnia, > 1 rozjaśnia. */
export function shade(hex: string, factor: number): string {
  const [r, g, b] = parse(hex).map((c) =>
    Math.max(0, Math.min(255, Math.round(factor > 1 ? c + (255 - c) * (factor - 1) : c * factor))),
  );
  return `rgb(${r},${g},${b})`;
}
