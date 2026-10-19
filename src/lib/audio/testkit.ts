/** Tylko testy: atrapa Web Audio z rejestrem węzłów, połączeń i wywołań. */
import type { AudioManifest } from "./manifest";

export class FakeParam {
  target: number;
  tau = 0;
  calls = 0;
  private current: number;
  constructor(initial = 0) {
    this.current = initial;
    this.target = initial;
  }
  get value() {
    return this.current;
  }
  set value(v: number) {
    this.current = v;
    this.target = v;
  }
  setTargetAtTime(v: number, _t: number, tau: number) {
    this.target = v;
    this.current = v;
    this.tau = tau;
    this.calls++;
  }
  setValueAtTime(v: number) {
    this.value = v;
  }
}

export class FakeNode {
  connections = new Set<FakeNode>();
  disconnected = false;
  constructor(readonly kind: string, readonly ctx: FakeContext) {
    ctx.nodes.push(this);
  }
  connect(dest: FakeNode) {
    this.connections.add(dest);
    return dest;
  }
  disconnect() {
    this.connections.clear();
    this.disconnected = true;
  }
}

export class FakeGain extends FakeNode {
  gain = new FakeParam(1);
  constructor(ctx: FakeContext) {
    super("gain", ctx);
  }
}

export class FakeFilter extends FakeNode {
  type = "lowpass";
  frequency = new FakeParam(350);
  constructor(ctx: FakeContext) {
    super("biquad", ctx);
  }
}

export class FakeCompressor extends FakeNode {
  threshold = new FakeParam(-24);
  ratio = new FakeParam(12);
  constructor(ctx: FakeContext) {
    super("compressor", ctx);
  }
}

export class FakePanner extends FakeNode {
  panningModel = "equalpower";
  distanceModel = "inverse";
  refDistance = 1;
  rolloffFactor = 1;
  maxDistance = 10000;
  positionX = new FakeParam();
  positionY = new FakeParam();
  positionZ = new FakeParam();
  constructor(ctx: FakeContext) {
    super("panner", ctx);
  }
  get position() {
    return { x: this.positionX.value, y: this.positionY.value, z: this.positionZ.value };
  }
}

export class FakeBuffer {
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
    readonly id = "",
  ) {}
  get duration() {
    return this.length / this.sampleRate;
  }
  private data = new Float32Array(0);
  getChannelData() {
    if (this.data.length !== this.length) this.data = new Float32Array(this.length);
    return this.data;
  }
}

export class FakeSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  loop = false;
  playbackRate = new FakeParam(1);
  started: { when: number; offset?: number; duration?: number } | null = null;
  stopped = false;
  onended: (() => void) | null = null;
  constructor(ctx: FakeContext) {
    super("source", ctx);
    ctx.sources.push(this);
  }
  start(when = 0, offset?: number, duration?: number) {
    this.started = { when, offset, duration };
  }
  stop() {
    if (!this.started) throw new Error("stop bez start");
    this.stopped = true;
  }
  /** Symuluje naturalny koniec odtwarzania. */
  finish() {
    this.stopped = true;
    this.onended?.();
  }
}

export class FakeListener {
  positionX = new FakeParam();
  positionY = new FakeParam();
  positionZ = new FakeParam();
  forwardX = new FakeParam();
  forwardY = new FakeParam();
  forwardZ = new FakeParam(-1);
  upX = new FakeParam();
  upY = new FakeParam(1);
  upZ = new FakeParam();
}

export class FakeContext {
  state: "running" | "suspended" | "closed" = "running";
  currentTime = 0;
  sampleRate = 48000;
  nodes: FakeNode[] = [];
  sources: FakeSource[] = [];
  listener = new FakeListener();
  destination = new FakeNode("destination", this);
  resumeCalls = 0;
  suspendCalls = 0;
  decoded: string[] = [];
  /** Czy `resume()` może przejść (symulacja autoplay). */
  allowResume = true;

  createGain() {
    return new FakeGain(this);
  }
  createBiquadFilter() {
    return new FakeFilter(this);
  }
  createDynamicsCompressor() {
    return new FakeCompressor(this);
  }
  createPanner() {
    return new FakePanner(this);
  }
  createBufferSource() {
    return new FakeSource(this);
  }
  createBuffer(channels: number, length: number, rate: number) {
    return new FakeBuffer(channels, length, rate, "synth");
  }
  async decodeAudioData(data: ArrayBuffer) {
    const text = new TextDecoder().decode(data);
    this.decoded.push(text);
    const [id, seconds] = text.split("|");
    return new FakeBuffer(2, Math.round(Number(seconds) * this.sampleRate), this.sampleRate, id);
  }
  async resume() {
    this.resumeCalls++;
    if (this.allowResume && this.state !== "closed") this.state = "running";
  }
  async suspend() {
    this.suspendCalls++;
    if (this.state !== "closed") this.state = "suspended";
  }
  async close() {
    this.state = "closed";
  }
}

export const TEST_MANIFEST: AudioManifest = {
  version: 1,
  sampleRate: 48000,
  assets: Object.fromEntries(
    (
      [
        ["ambience.day", "ambience", 2, true, 54.4],
        ["ambience.night", "ambience", 2, true, 46.7],
        ["bird.cockatoo", "bird", 1, false, 1.5],
        ["bird.jungle", "bird", 1, false, 1.5],
        ["bird.screech", "bird", 1, false, 2],
        ["event.wolves", "event", 1, false, 9.7],
      ] as const
    ).map(([id, role, channels, loop, seconds]) => [
      id,
      {
        id,
        role,
        channels,
        loop,
        seconds,
        frames: Math.round(seconds * 48000),
        files: [
          { url: `/audio/${id}.ogg`, type: 'audio/ogg; codecs="opus"', bytes: 1 },
          { url: `/audio/${id}.m4a`, type: 'audio/mp4; codecs="mp4a.40.2"', bytes: 1 },
        ],
      },
    ]),
  ),
};

export function fakeFetch(manifest: AudioManifest = TEST_MANIFEST, log: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    log.push(url);
    if (url.endsWith("audio.json")) return { ok: true, status: 200, json: async () => manifest } as Response;
    const id = url.replace("/audio/", "").replace(/\.(ogg|m4a)$/, "");
    const entry = manifest.assets[id];
    if (!entry) return { ok: false, status: 404 } as Response;
    const bytes = new TextEncoder().encode(`${id}|${entry.seconds}`);
    return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } as Response;
  }) as typeof fetch;
}

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
}

type Listener = (...args: unknown[]) => void;

export class FakeTarget {
  hidden = false;
  listeners = new Map<string, Set<Listener>>();
  addEventListener(name: string, fn: Listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name)!.add(fn);
  }
  removeEventListener(name: string, fn: Listener) {
    this.listeners.get(name)?.delete(fn);
  }
  emit(name: string) {
    for (const fn of [...(this.listeners.get(name) ?? [])]) fn();
  }
  count() {
    let n = 0;
    for (const set of this.listeners.values()) n += set.size;
    return n;
  }
}
