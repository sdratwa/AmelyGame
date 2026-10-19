import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isAudioManifest, type AudioManifest } from "./manifest";
import { BIRD_IDS } from "./wildlife";

const ROOT = path.resolve(__dirname, "../../..");
const PUBLIC = path.join(ROOT, "public/audio");
const manifest = JSON.parse(fs.readFileSync(path.join(PUBLIC, "audio.json"), "utf8")) as AudioManifest;

describe("zasoby audio", () => {
  it("manifest jest poprawny i zawiera dokładnie wymagane nagrania", () => {
    expect(isAudioManifest(manifest)).toBe(true);
    for (const id of ["ambience.day", "ambience.night", "event.wolves", ...BIRD_IDS]) expect(manifest.assets[id]).toBeTruthy();
    const sources = Object.values(manifest.assets).map((a) => (a as unknown as { source: { file: string } }).source.file);
    expect(sources.sort()).toEqual(
      [
        "mixkit-birds-in-forest-loop-1239.wav",
        "mixkit-forest-at-night-1224.wav",
        "mixkit-cockatoo-bird-squawk-2437.wav",
        "mixkit-bird-screeching-in-the-jungle-2436.wav",
        "mixkit-bird-screech-2435.wav",
        "mixkit-wolves-at-scary-forest-2485.wav",
      ].sort(),
    );
  });

  it("każdy plik istnieje, ma rozmiar z manifestu i zapas w drugim formacie", () => {
    for (const entry of Object.values(manifest.assets)) {
      expect(entry.files.map((f) => f.type.split(";")[0]).sort()).toEqual(["audio/mp4", "audio/ogg"]);
      for (const f of entry.files) {
        const stat = fs.statSync(path.join(ROOT, "public", f.url));
        expect(stat.size).toBe(f.bytes);
        expect(stat.size).toBeLessThan(900_000);
      }
    }
  });

  it("pętle są stereo i bezszwowe (skok na złączeniu nie przekracza typowej różnicy próbek)", () => {
    for (const id of ["ambience.day", "ambience.night"]) {
      const e = manifest.assets[id] as unknown as { channels: number; loop: boolean; seconds: number; verify: { ogg: { seamJump: number; typicalDelta: number; seconds: number }; m4a: { seamJump: number; typicalDelta: number } } };
      expect(e.channels).toBe(2);
      expect(e.loop).toBe(true);
      expect(e.verify.ogg.seamJump).toBeLessThanOrEqual(e.verify.ogg.typicalDelta * 2);
      expect(e.verify.m4a.seamJump).toBeLessThanOrEqual(e.verify.m4a.typicalDelta * 2.5 + 0.002);
      expect(Math.abs(e.verify.ogg.seconds - e.seconds)).toBeLessThan(0.01);
    }
    expect(manifest.assets["ambience.day"].seconds).toBeGreaterThan(53);
    expect(manifest.assets["ambience.night"].seconds).toBeGreaterThan(46);
  });

  it("efekty są mono i nie są pętlami; wilki trwają ok. 9 s", () => {
    for (const id of [...BIRD_IDS, "event.wolves"]) {
      expect(manifest.assets[id].channels).toBe(1);
      expect(manifest.assets[id].loop).toBe(false);
    }
    expect(manifest.assets["event.wolves"].seconds).toBeGreaterThan(9);
    expect(manifest.assets["event.wolves"].seconds).toBeLessThan(10);
  });

  it("materiały źródłowe WAV są poza zasobami publicznymi", () => {
    expect(fs.readdirSync(PUBLIC).some((f) => f.endsWith(".wav"))).toBe(false);
    for (const f of ["mixkit-birds-in-forest-loop-1239.wav", "mixkit-forest-at-night-1224.wav", "mixkit-wolves-at-scary-forest-2485.wav"]) {
      expect(fs.existsSync(path.join(ROOT, "assets/source/audio", f))).toBe(true);
    }
  });
});

describe("izolacja audio od logiki gry", () => {
  const dir = path.join(ROOT, "src/lib/audio");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "testkit.ts");

  it("moduły audio nie importują silnika, zapisu, generatora ani strumieni losowości świata", () => {
    for (const f of files) {
      const text = fs.readFileSync(path.join(dir, f), "utf8");
      const imports = [...text.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
      for (const i of imports) {
        if (i.startsWith("@/lib/game")) expect(i, `${f} importuje ${i}`).toBe("@/lib/game/core/constants");
      }
      expect(text, f).not.toMatch(/rngStream|worldSeed|SaveV2|forestOf/);
    }
  });

  it("stan gry i zapis nie znają audio", () => {
    const check = (d: string) => {
      for (const entry of fs.readdirSync(path.join(ROOT, d), { recursive: true }) as string[]) {
        if (!/\.tsx?$/.test(entry) || /\.test\./.test(entry)) continue;
        const text = fs.readFileSync(path.join(ROOT, d, entry), "utf8");
        expect(text, `${d}/${entry}`).not.toMatch(/wolves|@\/lib\/audio|forestAudio|AudioContext/i);
      }
    };
    check("src/lib/game/core");
    check("src/lib/game/save");
    check("src/lib/game/world");
  });
});
