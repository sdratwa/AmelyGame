import type { AudioManifest } from "./manifest";

export type LoaderDeps = {
  fetch: typeof fetch;
  /** Czy przeglądarka deklaruje obsługę danego typu MIME (`canPlayType`). */
  canPlay: (type: string) => boolean;
};

/**
 * Leniwe wczytywanie i dekodowanie nagrań. Jedno wczytanie na identyfikator (bez duplikatów pętli), wybór formatu
 * według obsługi przeglądarki z automatycznym przejściem na format zapasowy przy błędzie dekodowania,
 * zwalnianie pojedynczych nagrań i przerwanie wszystkich pobrań przy zamknięciu.
 */
export class AssetLoader {
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly pending = new Map<string, Promise<AudioBuffer>>();
  private readonly abort = new AbortController();
  private disposed = false;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly manifest: AudioManifest,
    private readonly deps: LoaderDeps,
  ) {}

  has(id: string): boolean {
    return id in this.manifest.assets;
  }

  entry(id: string) {
    return this.manifest.assets[id] ?? null;
  }

  get(id: string): AudioBuffer | null {
    return this.buffers.get(id) ?? null;
  }

  isLoading(id: string): boolean {
    return this.pending.has(id);
  }

  get loadedCount(): number {
    return this.buffers.size;
  }

  loaded(): string[] {
    return [...this.buffers.keys()];
  }

  load(id: string): Promise<AudioBuffer> {
    const ready = this.buffers.get(id);
    if (ready) return Promise.resolve(ready);
    const running = this.pending.get(id);
    if (running) return running;
    const entry = this.manifest.assets[id];
    if (!entry) return Promise.reject(new Error(`Brak nagrania ${id} w manifeście audio`));
    const supported = entry.files.filter((f) => this.deps.canPlay(f.type));
    const rest = entry.files.filter((f) => !supported.includes(f));
    const order = [...supported, ...rest];
    const task = (async () => {
      let lastError: unknown = null;
      for (const file of order) {
        try {
          const response = await this.deps.fetch(file.url, { signal: this.abort.signal });
          if (!response.ok) throw new Error(`HTTP ${response.status} dla ${file.url}`);
          const data = await response.arrayBuffer();
          const buffer = await this.ctx.decodeAudioData(data);
          if (this.disposed) throw new Error("Zwolniono moduł audio");
          this.buffers.set(id, buffer);
          return buffer;
        } catch (error) {
          lastError = error;
          if (this.disposed) break;
        }
      }
      throw lastError instanceof Error ? lastError : new Error(`Nie udało się wczytać ${id}`);
    })().finally(() => {
      this.pending.delete(id);
    });
    this.pending.set(id, task);
    return task;
  }

  release(id: string): void {
    this.buffers.delete(id);
  }

  dispose(): void {
    this.disposed = true;
    this.abort.abort();
    this.buffers.clear();
    this.pending.clear();
  }
}
