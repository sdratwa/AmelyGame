#!/usr/bin/env node
/**
 * Potok audio lasu: `assets/source/audio/*.wav` (Mixkit, materiały źródłowe poza publicznymi zasobami)
 * -> `public/audio/<id>.ogg` (Opus) + `<id>.m4a` (AAC, format zapasowy dla Safari) + `public/audio/audio.json`.
 *
 *   npm run assets:audio
 *
 * Wymaga ffmpeg (libopus, aac) w PATH. Dla każdego nagrania:
 *  - 48 kHz (bez niedokładności długości przy kodowaniu); pętle stereo, efekty mono (panner 3D i tak miksuje do mono),
 *  - normalizacja głośności (EBU R128, stała poprawka w dB; bez limitera - sprawdzany szczyt <= -1 dBFS),
 *  - pętle: krótki crossfade równej mocy końca z początkiem (plik jest wtedy bezszwowy przy `loop = true`),
 *  - efekty: 5 ms wejścia i wyjścia przeciw trzaskom,
 *  - po zakodowaniu: odczyt zwrotny (liczba próbek, skok na szwie pętli) trafia do manifestu.
 * Plik kroków (`mixkit-stepping-on-leaves-in-a-forest-2429.wav`) jest opcjonalny: gdy go nie ma, manifest nie zawiera
 * wpisu `footsteps.leaves`, a gra używa syntetycznego zastępnika. Gdy jest, wykrywane są pojedyncze kroki
 * (`src/lib/audio/onsets.ts`): jeden krok albo sekwencja z podziałem na segmenty.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectSteps } from "../../src/lib/audio/onsets.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SRC_DIR = path.join(ROOT, "assets/source/audio");
const OUT_DIR = path.join(ROOT, "public/audio");
const RATE = 48000;
const PEAK_LIMIT_DB = -1;
const LICENSE = "Mixkit Sound Effects Free License (https://mixkit.co/license/#sfxFree)";

/** Docelowe głośności (LUFS) odpowiadają roli: tło cichsze od efektów, które w grze tłumi jeszcze odległość. */
const ASSETS = [
  { id: "ambience.day", file: "mixkit-birds-in-forest-loop-1239.wav", role: "ambience", channels: 2, loop: true, lufs: -23, fade: 0.3, opus: "96k", aac: "112k" },
  { id: "ambience.night", file: "mixkit-forest-at-night-1224.wav", role: "ambience", channels: 2, loop: true, lufs: -23, fade: 0.3, opus: "96k", aac: "112k" },
  { id: "bird.cockatoo", file: "mixkit-cockatoo-bird-squawk-2437.wav", role: "bird", channels: 1, loop: false, lufs: -17, opus: "64k", aac: "64k" },
  { id: "bird.jungle", file: "mixkit-bird-screeching-in-the-jungle-2436.wav", role: "bird", channels: 1, loop: false, lufs: -17, opus: "64k", aac: "64k" },
  { id: "bird.screech", file: "mixkit-bird-screech-2435.wav", role: "bird", channels: 1, loop: false, lufs: -17, opus: "64k", aac: "64k" },
  { id: "event.wolves", file: "mixkit-wolves-at-scary-forest-2485.wav", role: "event", channels: 1, loop: false, lufs: -19, opus: "64k", aac: "64k" },
  { id: "footsteps.leaves", file: "mixkit-stepping-on-leaves-in-a-forest-2429.wav", role: "footsteps", channels: 1, loop: false, lufs: -22, opus: "64k", aac: "64k", optional: true, steps: true },
];

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

function ffmpeg(args, options = {}) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-v", "error", ...args], { maxBuffer: 1 << 30, ...options });
  if (r.status !== 0) throw new Error(`ffmpeg ${args.join(" ")}\n${r.stderr?.toString()}`);
  return r;
}

function decode(file, channels) {
  const r = ffmpeg(["-i", file, "-ac", String(channels), "-ar", String(RATE), "-f", "f32le", "-"]);
  const b = r.stdout;
  return new Float32Array(b.buffer, b.byteOffset, Math.floor(b.byteLength / 4)).slice();
}

function loudness(file, channels) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-ac", String(channels), "-ar", String(RATE), "-af", "ebur128=peak=true", "-f", "null", "-"], { maxBuffer: 1 << 28 });
  const text = r.stderr.toString();
  const i = /Integrated loudness:\s*\n\s*I:\s*(-?[\d.]+) LUFS/.exec(text);
  const p = /True peak:\s*\n\s*Peak:\s*(-?[\d.]+) dBFS/.exec(text);
  if (!i) throw new Error(`Brak pomiaru głośności dla ${file}`);
  return { lufs: Number(i[1]), truePeakDb: p ? Number(p[1]) : null };
}

function deinterleavedPeak(samples) {
  let peak = 0;
  for (const v of samples) peak = Math.max(peak, Math.abs(v));
  return peak;
}

/** Bezszwowa pętla: głowa wchodzi z równą mocą, a nakładający się ogon wychodzi; długość skraca się o `fade`. */
function makeLoop(samples, channels, fadeSeconds) {
  const frames = samples.length / channels;
  const f = Math.round(fadeSeconds * RATE);
  const outFrames = frames - f;
  const out = new Float32Array(outFrames * channels);
  for (let i = 0; i < outFrames; i++) {
    for (let c = 0; c < channels; c++) {
      let v = samples[i * channels + c];
      if (i < f) {
        const w = (i / f) * (Math.PI / 2);
        v = v * Math.sin(w) + samples[(frames - f + i) * channels + c] * Math.cos(w);
      }
      out[i * channels + c] = v;
    }
  }
  return out;
}

function fadeEdges(samples, channels, seconds) {
  const frames = samples.length / channels;
  const n = Math.min(Math.round(seconds * RATE), frames >> 1);
  for (let i = 0; i < n; i++) {
    const w = i / n;
    for (let c = 0; c < channels; c++) {
      samples[i * channels + c] *= w;
      samples[(frames - 1 - i) * channels + c] *= w;
    }
  }
}

function toBuffer(samples) {
  return Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
}

function readBack(file, channels) {
  const samples = decode(file, channels);
  const frames = samples.length / channels;
  let seam = 0;
  for (let c = 0; c < channels; c++) seam = Math.max(seam, Math.abs(samples[c] - samples[(frames - 1) * channels + c]));
  let delta = 0;
  for (let i = 1; i < Math.min(frames, 48000); i++) delta += Math.abs(samples[i * channels] - samples[(i - 1) * channels]);
  return { frames, seconds: frames / RATE, seamJump: round(seam, 5), typicalDelta: round(delta / Math.min(frames - 1, 47999), 5) };
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "miasto-audio-"));
const manifest = { version: 1, sampleRate: RATE, license: LICENSE, assets: {} };

try {
  for (const spec of ASSETS) {
    const src = path.join(SRC_DIR, spec.file);
    if (!fs.existsSync(src)) {
      if (spec.optional) {
        console.warn(`Pominięto ${spec.id}: brak ${spec.file} (gra użyje syntetycznego zastępnika).`);
        continue;
      }
      throw new Error(`Brak pliku źródłowego ${src}`);
    }
    const srcBytes = fs.readFileSync(src);
    const measured = loudness(src, spec.channels);
    let gainDb = spec.lufs - measured.lufs;
    let samples = decode(src, spec.channels);
    const sourceSeconds = samples.length / spec.channels / RATE;

    if (spec.loop) samples = makeLoop(samples, spec.channels, spec.fade);
    else fadeEdges(samples, spec.channels, 0.005);

    const peak = deinterleavedPeak(samples);
    const peakDbAfter = 20 * Math.log10(peak || 1e-9) + gainDb;
    if (peakDbAfter > PEAK_LIMIT_DB) gainDb -= peakDbAfter - PEAK_LIMIT_DB;
    const gain = 10 ** (gainDb / 20);
    for (let i = 0; i < samples.length; i++) samples[i] *= gain;

    const raw = path.join(tmp, `${spec.id}.f32`);
    fs.writeFileSync(raw, toBuffer(samples));
    const input = ["-f", "f32le", "-ar", String(RATE), "-ac", String(spec.channels), "-i", raw];
    const ogg = path.join(OUT_DIR, `${spec.id}.ogg`);
    const m4a = path.join(OUT_DIR, `${spec.id}.m4a`);
    ffmpeg(["-y", ...input, "-c:a", "libopus", "-b:a", spec.opus, "-application", "audio", "-vbr", "on", ogg]);
    ffmpeg(["-y", ...input, "-c:a", "aac", "-b:a", spec.aac, "-movflags", "+faststart", m4a]);

    const frames = samples.length / spec.channels;
    const entry = {
      id: spec.id,
      role: spec.role,
      channels: spec.channels,
      loop: spec.loop,
      seconds: round(frames / RATE),
      frames,
      files: [
        { url: `/audio/${spec.id}.ogg`, type: 'audio/ogg; codecs="opus"', bytes: fs.statSync(ogg).size },
        { url: `/audio/${spec.id}.m4a`, type: 'audio/mp4; codecs="mp4a.40.2"', bytes: fs.statSync(m4a).size },
      ],
      loudness: { measuredLufs: measured.lufs, targetLufs: spec.lufs, appliedGainDb: round(gainDb, 2), sourceTruePeakDb: measured.truePeakDb },
      loopCrossfadeSeconds: spec.loop ? spec.fade : 0,
      verify: { ogg: readBack(ogg, spec.channels), m4a: readBack(m4a, spec.channels) },
      source: { file: spec.file, bytes: srcBytes.length, sha256: sha256(srcBytes), seconds: round(sourceSeconds) },
    };

    if (spec.steps) {
      const analysis = detectSteps(samples, RATE);
      entry.steps = analysis.kind === "silent" ? { kind: "single", segments: [{ start: 0, end: entry.seconds }] } : analysis;
    }

    manifest.assets[spec.id] = entry;
    const v = entry.verify;
    console.log(
      `${spec.id.padEnd(18)} ${entry.seconds.toFixed(2)} s  ${spec.channels}ch  ${measured.lufs.toFixed(1)} -> ${spec.lufs} LUFS (${gainDb.toFixed(1)} dB)  ogg ${(entry.files[0].bytes / 1024).toFixed(0)} KB  m4a ${(entry.files[1].bytes / 1024).toFixed(0)} KB  szew ${v.ogg.seamJump} (typ. ${v.ogg.typicalDelta})`,
    );
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

fs.writeFileSync(path.join(OUT_DIR, "audio.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Manifest: ${path.relative(ROOT, path.join(OUT_DIR, "audio.json"))}`);
