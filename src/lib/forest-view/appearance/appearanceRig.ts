import * as THREE from "three";
import type { PlayerAsset } from "@/lib/assets/characters";
import {
  DEFAULT_HEAD_METRICS,
  HAIR_GENERATORS,
  anyRuleHides,
  cloneFit,
  deriveShell,
  findItem,
  glbFileForLod,
  jointRegionsOf,
  measureHead,
  normalizeAppearance,
  sanitizeFit,
  vertexRegions,
  IDENTITY_FIT,
  type BodyHideRule,
  type BodyMeshInput,
  type BodyRegion,
  type CatalogItem,
  type CharacterAppearanceV1,
  type HeadMetrics,
  type MeshData,
  type PartFit,
  type SlotId,
} from "@/lib/character";
import { createHairMaterial, sharedGlbHairCache, type GlbHairCache, type HairMaterialHandle } from "./hairGlb";

type VisualSlot = Extract<SlotId, "hair" | "top" | "bottom">;
const VISUAL_SLOTS: readonly VisualSlot[] = ["hair", "top", "bottom"];
/** Gdy element GLB nie ma `defaultColor`: kolor oznaczający "oryginał" (biały: brak przebarwiania). */
const DEFAULT_ORIGINAL_COLOR = "#ffffff";

type Mounted = {
  item: CatalogItem;
  object: THREE.Object3D;
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  triangles: number;
  /** Punkt, względem którego liczone jest dopasowanie: środek głowy (fryzury proceduralne) albo początek kości głowy (GLB). */
  origin: readonly [number, number, number];
  /** Czy rig jest właścicielem geometrii (GLB: geometria jest współdzielona w cache). */
  ownsGeometry: boolean;
  /** Sprzątanie zasobów instancji (klon materiału, zwolnienie wpisu w cache). */
  onRemove?: () => void;
  setColor?: (hex: string) => void;
};

/** Opcje rigu: cache GLB (domyślnie wspólny), katalog plików GLB i startowe dopasowania zapisane przez autora. */
export type AppearanceRigOptions = {
  castShadow?: boolean;
  receiveShadow?: boolean;
  cache?: GlbHairCache;
  glbBaseUrl?: string;
  fits?: Readonly<Record<string, PartFit>>;
  /** Wołane po asynchronicznej zmianie (fryzura GLB wczytana albo nieudana); kreator odświeża wtedy statystyki. */
  onUpdate?: () => void;
};

export type AppearanceStats = {
  hair: string | null;
  top: string | null;
  bottom: string | null;
  /** ID elementów GLB, które są właśnie wczytywane (poprzedni element zostaje widoczny do czasu wczytania). */
  loading: string[];
  /** Elementy z rejestru, których geometrii nie udało się założyć (brak zasobu albo błąd), z powodem. */
  missing: { id: string; reason: string }[];
  triangles: { hair: number; top: number; bottom: number; body: number; bodyHidden: number };
  /** Dodatkowe draw calle ponad siatkę bazową. */
  extraDrawCalls: number;
};

function bodyFrom(skinned: THREE.SkinnedMesh): BodyMeshInput & { headWeight: Float32Array } {
  const g = skinned.geometry;
  const pos = g.getAttribute("position");
  const uv = g.getAttribute("uv");
  const si = g.getAttribute("skinIndex");
  const sw = g.getAttribute("skinWeight");
  const index = g.getIndex();
  const n = pos.count;
  const positions = new Float32Array(n * 3);
  const uvs = new Float32Array(n * 2);
  const skinIndex = new Uint16Array(n * 4);
  const skinWeight = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    positions[i * 3] = pos.getX(i);
    positions[i * 3 + 1] = pos.getY(i);
    positions[i * 3 + 2] = pos.getZ(i);
    if (uv) {
      uvs[i * 2] = uv.getX(i);
      uvs[i * 2 + 1] = uv.getY(i);
    }
    skinIndex[i * 4] = si.getX(i);
    skinIndex[i * 4 + 1] = si.getY(i);
    skinIndex[i * 4 + 2] = si.getZ(i);
    skinIndex[i * 4 + 3] = si.getW(i);
    skinWeight[i * 4] = sw.getX(i);
    skinWeight[i * 4 + 1] = sw.getY(i);
    skinWeight[i * 4 + 2] = sw.getZ(i);
    skinWeight[i * 4 + 3] = sw.getW(i);
  }
  const indices = new Uint32Array(index ? index.count : n);
  if (index) for (let i = 0; i < index.count; i++) indices[i] = index.getX(i);
  else for (let i = 0; i < n; i++) indices[i] = i;
  const jointRegions = jointRegionsOf(skinned.skeleton.bones.map((b) => b.name));
  const headWeight = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 4; k++) if (jointRegions[skinIndex[i * 4 + k]] === "head") headWeight[i] += skinWeight[i * 4 + k];
  }
  return { positions, uvs, skinIndex, skinWeight, indices, jointRegions, headWeight };
}

function toGeometry(data: MeshData, skinned: boolean, recenter?: readonly [number, number, number]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const positions = data.positions.slice();
  if (recenter) {
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] -= recenter[0];
      positions[i + 1] -= recenter[1];
      positions[i + 2] -= recenter[2];
    }
  }
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(data.normals, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(data.uvs, 2));
  if (skinned && data.skinIndex && data.skinWeight) {
    g.setAttribute("skinIndex", new THREE.BufferAttribute(data.skinIndex, 4));
    g.setAttribute("skinWeight", new THREE.BufferAttribute(data.skinWeight, 4));
  }
  g.setIndex(new THREE.BufferAttribute(data.indices, 1));
  g.computeBoundingSphere();
  return g;
}

/**
 * Wygląd postaci gracza na wspólnym szkielecie: fryzura (sztywno na kości głowy), góra i dół (SkinnedMesh na tym samym
 * `Skeleton` co ciało, więc deformują się z tymi samymi kośćmi i animacjami) oraz ukrywanie fragmentów ciała pod ubraniem.
 * Wymiana elementu nie dotyka kontrolera, animatora ani pozycji: usuwa poprzedni element (geometria zwolniona z GPU) i
 * zakłada nowy. Materiały są jeden na slot (kolor niezależny), bufory indeksów ciała cache'owane per zestaw ukrytych części.
 */
export class AppearanceRig {
  private readonly skinned: THREE.SkinnedMesh;
  private readonly body: ReturnType<typeof bodyFrom>;
  private readonly head: HeadMetrics;
  private readonly headMount: THREE.Group | null;
  /** Kość głowy: do niej montowane są fryzury GLB (siatka jest już w układzie lokalnym tej kości). */
  private headBone: THREE.Object3D | null = null;
  private readonly materials: Record<VisualSlot, THREE.MeshStandardMaterial>;
  private readonly mounted: Partial<Record<VisualSlot, Mounted>> = {};
  private readonly missing = new Map<string, string>();
  private readonly fits = new Map<string, PartFit>();
  private readonly originalIndex: THREE.BufferAttribute;
  private readonly indexVariants = new Map<string, THREE.BufferAttribute>();
  private readonly triangleRegions: BodyRegion[][];
  private readonly triangleProbe: Float32Array;
  private shadows = { cast: true, receive: true };
  private readonly cacheOption: GlbHairCache | undefined;
  private readonly glbBaseUrl: string;
  private readonly onUpdate?: () => void;
  /** Cache GLB: wspólny dla gry i kreatora (tworzony dopiero przy pierwszej fryzurze GLB). */
  private get cache(): GlbHairCache {
    return this.cacheOption ?? sharedGlbHairCache();
  }
  /** Elementy GLB w trakcie wczytywania (jeden na slot); poprzedni element zostaje widoczny do czasu zakończenia. */
  private readonly pending: Partial<Record<VisualSlot, string>> = {};
  private hairVisible = true;
  private current: CharacterAppearanceV1 | null = null;
  private hiddenKey = "";
  private bodyHidden = 0;
  private disposed = false;

  constructor(
    asset: Pick<PlayerAsset, "skinned">,
    options: AppearanceRigOptions = {},
  ) {
    this.skinned = asset.skinned;
    this.cacheOption = options.cache;
    this.glbBaseUrl = options.glbBaseUrl ?? "/characters";
    this.onUpdate = options.onUpdate;
    for (const [id, fit] of Object.entries(options.fits ?? {})) this.fits.set(id, sanitizeFit(fit));
    this.shadows = { cast: options.castShadow ?? true, receive: options.receiveShadow ?? true };
    this.body = bodyFrom(this.skinned);
    this.head = measureHead(this.body.positions, this.body.headWeight) ?? DEFAULT_HEAD_METRICS;
    this.headMount = this.createHeadMount();
    const make = (color: string, roughness: number) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, side: THREE.DoubleSide });
    this.materials = { hair: make("#5b3a22", 0.92), top: make("#4f8f5a", 0.9), bottom: make("#6a4e38", 0.9) };
    const index = this.skinned.geometry.getIndex();
    if (!index) throw new Error("Siatka bazowa postaci nie ma indeksów: nie da się ukrywać fragmentów ciała");
    this.originalIndex = index;
    // Środki i regiony trójkątów liczone raz (ukrywanie przebudowuje tylko bufor indeksów, bez pracy w każdej klatce).
    const regions = vertexRegions(this.body);
    const tri = this.body.indices.length / 3;
    this.triangleRegions = new Array(tri);
    this.triangleProbe = new Float32Array(tri * 2);
    for (let t = 0; t < tri; t++) {
      const a = this.body.indices[t * 3];
      const b = this.body.indices[t * 3 + 1];
      const c = this.body.indices[t * 3 + 2];
      this.triangleRegions[t] = [regions[a], regions[b], regions[c]];
      const p = this.body.positions;
      this.triangleProbe[t * 2] = (p[a * 3] + p[b * 3] + p[c * 3]) / 3;
      this.triangleProbe[t * 2 + 1] = (p[a * 3 + 1] + p[b * 3 + 1] + p[c * 3 + 1]) / 3;
    }
  }

  /** Wymiary głowy użyte do dopasowania fryzur (z pliku). */
  get headMetrics(): HeadMetrics {
    return this.head;
  }

  get appearance(): CharacterAppearanceV1 | null {
    return this.current;
  }

  /** Mocowanie fryzur: dziecko kości głowy; transformacja przenosi przestrzeń modelu (pozy wiązania) do przestrzeni kości. */
  private createHeadMount(): THREE.Group | null {
    const bones = this.skinned.skeleton.bones;
    const idx = bones.findIndex((b) => /(^|:)Head$/.test(b.name) || b.name === "mixamorigHead");
    if (idx < 0) return null;
    const mount = new THREE.Group();
    mount.name = "appearance-head-mount";
    mount.matrixAutoUpdate = false;
    mount.matrix.multiplyMatrices(this.skinned.skeleton.boneInverses[idx], this.skinned.bindMatrix);
    mount.matrixWorldNeedsUpdate = true;
    bones[idx].add(mount);
    this.headBone = bones[idx];
    return mount;
  }

  /** Aktualne dopasowanie fryzury (z rejestru, jeśli nie zmienione). */
  getFit(id: string): PartFit {
    return cloneFit(this.fits.get(id) ?? findItem(id)?.fit ?? IDENTITY_FIT);
  }

  setFit(id: string, fit: unknown): PartFit {
    const next = sanitizeFit(fit, this.getFit(id));
    this.fits.set(id, next);
    const m = this.mounted.hair;
    if (m && m.item.id === id) this.applyFit(m, next);
    return cloneFit(next);
  }

  resetFit(id: string): PartFit {
    this.fits.delete(id);
    const fit = this.getFit(id);
    const m = this.mounted.hair;
    if (m && m.item.id === id) this.applyFit(m, fit);
    return fit;
  }

  /** Widoczność fryzury (dla podglądu dopasowania); zostaje przy zmianie fryzury. */
  setHairVisible(visible: boolean): void {
    this.hairVisible = visible;
    const m = this.mounted.hair;
    if (m) m.object.visible = visible;
  }

  get isHairVisible(): boolean {
    return this.hairVisible;
  }

  /** Dopasowanie jest dodatkiem do transformacji z pliku/rejestru: pozycja względem punktu `origin`, obrót i skala wokół niego. */
  private applyFit(m: Mounted, fit: PartFit): void {
    const pivot = m.object;
    const c = m.origin;
    pivot.position.set(c[0] + fit.position[0], c[1] + fit.position[1], c[2] + fit.position[2]);
    pivot.rotation.set((fit.rotationDeg[0] * Math.PI) / 180, (fit.rotationDeg[1] * Math.PI) / 180, (fit.rotationDeg[2] * Math.PI) / 180);
    pivot.scale.set(fit.scale[0], fit.scale[1], fit.scale[2]);
  }

  setShadows(cast: boolean, receive: boolean): void {
    this.shadows = { cast, receive };
    for (const m of Object.values(this.mounted)) {
      if (!m) continue;
      m.mesh.castShadow = cast;
      m.mesh.receiveShadow = receive;
    }
  }

  /**
   * Ustawia wygląd: wymienia tylko zmienione elementy, kolor zmienia się osobno dla każdego slotu. Bezpieczne do wołania
   * w każdej klatce lub przy każdej zmianie stanu (bez zmian nic nie robi).
   */
  apply(input: CharacterAppearanceV1): void {
    if (this.disposed) return;
    const next = normalizeAppearance(input);
    const prev = this.current;
    this.current = next;
    const ids: Record<VisualSlot, string | null> = { hair: next.hairStyleId, top: next.topId, bottom: next.bottomId };
    const colors: Record<VisualSlot, string> = { hair: next.hairColor, top: next.topColor, bottom: next.bottomColor };
    const prevIds: Record<VisualSlot, string | null> | null = prev ? { hair: prev.hairStyleId, top: prev.topId, bottom: prev.bottomId } : null;
    for (const slot of VISUAL_SLOTS) {
      const mountedId = this.mounted[slot]?.item.id ?? null;
      const wanted = ids[slot];
      const failedBefore = wanted !== null && prevIds?.[slot] === wanted && this.missing.has(wanted);
      const wantedItem = wanted ? findItem(wanted, slot) : null;
      if (wanted === mountedId) {
        // Wybrany element już stoi: ewentualne wczytywanie innego elementu jest nieaktualne.
        delete this.pending[slot];
      } else if (wantedItem?.source.kind === "glb" && wantedItem.status === "ready") {
        // GLB wczytuje się asynchronicznie: stary element zostaje widoczny do momentu wczytania nowego (bez migania łysą głową).
        if (this.pending[slot] !== wanted && !failedBefore) this.beginGlb(slot, wantedItem);
      } else if (!failedBefore) {
        delete this.pending[slot];
        this.unmount(slot);
        if (wanted) this.mount(slot, wanted);
      }
      this.materials[slot].color.set(colors[slot]);
      this.mounted[slot]?.setColor?.(colors[slot]);
    }
    this.updateBodyMask();
  }

  private mount(slot: VisualSlot, id: string): void {
    const item = findItem(id, slot);
    if (!item) {
      this.missing.set(id, "nieznany element rejestru");
      return;
    }
    this.missing.delete(id);
    if (item.status === "missing_asset") {
      this.missing.set(id, "brakujący zasób (status missing_asset)");
      return;
    }
    try {
      const made = this.build(slot, item);
      if (!made) return;
      this.mounted[slot] = made;
    } catch (e) {
      this.missing.set(id, e instanceof Error ? e.message : String(e));
      console.error(e);
    }
  }

  private build(slot: VisualSlot, item: CatalogItem): Mounted | null {
    const src = item.source;
    const material = this.materials[slot];
    if (src.kind === "glb") {
      // GLB jest wczytywany asynchronicznie przez `beginGlb`; ta ścieżka nie powinna go dotyczyć.
      this.missing.set(item.id, `GLB (${src.file}) wymaga wczytania asynchronicznego`);
      return null;
    }
    if (src.kind === "procedural") {
      const generator = HAIR_GENERATORS[src.generator];
      if (!generator) throw new Error(`brak generatora fryzury: ${src.generator}`);
      if (!this.headMount) throw new Error("brak kości głowy: nie da się zamocować fryzury");
      const geometry = toGeometry(generator(this.head), false, this.head.center);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `appearance-${item.id}`;
      mesh.castShadow = this.shadows.cast;
      mesh.receiveShadow = this.shadows.receive;
      mesh.frustumCulled = false;
      const pivot = new THREE.Group();
      pivot.name = `appearance-${item.id}-pivot`;
      pivot.add(mesh);
      const made: Mounted = { item, object: pivot, mesh, geometry, triangles: geometry.getIndex()!.count / 3, origin: this.head.center, ownsGeometry: true };
      this.applyFit(made, this.getFit(item.id));
      pivot.visible = slot !== "hair" || this.hairVisible;
      this.headMount.add(pivot);
      return made;
    }
    const data = deriveShell(this.body, src.shell);
    const geometry = toGeometry(data, true);
    const mesh = new THREE.SkinnedMesh(geometry, material);
    mesh.name = `appearance-${item.id}`;
    mesh.bind(this.skinned.skeleton, this.skinned.bindMatrix);
    // Ten sam węzeł nadrzędny i ta sama macierz co ciało: ubranie i ciało mają identyczny `matrixWorld`.
    mesh.matrix.copy(this.skinned.matrix);
    mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
    mesh.frustumCulled = false;
    mesh.castShadow = this.shadows.cast;
    mesh.receiveShadow = this.shadows.receive;
    (this.skinned.parent ?? this.skinned).add(mesh);
    return { item, object: mesh, mesh, geometry, triangles: data.indices.length / 3, origin: [0, 0, 0], ownsGeometry: true };
  }

  /**
   * Fryzura GLB: pobranie (lub trafienie w cache) i zamocowanie jako dziecko kości głowy. Plik ma już transformację
   * do układu lokalnego głowy (`head_bone_local`), więc baza to dokładnie transformacja węzła z pliku (zwykle tożsamość);
   * dopasowanie z kreatora jest dodatkowe (grupa nadrzędna), nic nie jest skalowane automatycznie.
   */
  private beginGlb(slot: VisualSlot, item: CatalogItem): void {
    const file = glbFileForLod(item, 0);
    if (!file || item.source.kind !== "glb") return;
    const url = `${this.glbBaseUrl}/${file}`;
    this.pending[slot] = item.id;
    this.missing.delete(item.id);
    this.cache.acquire(url).then(
      (asset) => {
        if (this.disposed || this.pending[slot] !== item.id) {
          this.cache.release(url);
          return;
        }
        delete this.pending[slot];
        let handle: HairMaterialHandle | null = null;
        try {
          if (!this.headBone) throw new Error("brak kości głowy: nie da się zamocować fryzury");
          handle = createHairMaterial(asset.material, asset.referenceLuma);
          const mesh = new THREE.Mesh(asset.geometry, handle.material);
          mesh.name = `appearance-${item.id}`;
          mesh.matrixAutoUpdate = false;
          mesh.matrix.copy(asset.baseMatrix);
          mesh.matrixWorldNeedsUpdate = true;
          mesh.castShadow = this.shadows.cast;
          mesh.receiveShadow = this.shadows.receive;
          mesh.frustumCulled = false;
          const pivot = new THREE.Group();
          pivot.name = `appearance-${item.id}-pivot`;
          pivot.add(mesh);
          pivot.visible = slot !== "hair" || this.hairVisible;
          const material = handle;
          const made: Mounted = {
            item,
            object: pivot,
            mesh,
            geometry: asset.geometry,
            triangles: asset.triangles,
            origin: [0, 0, 0],
            ownsGeometry: false,
            onRemove: () => {
              material.dispose();
              this.cache.release(url);
            },
            setColor: (hex) => material.setColor(hex, item.defaultColor ?? DEFAULT_ORIGINAL_COLOR),
          };
          this.applyFit(made, this.getFit(item.id));
          this.headBone.add(pivot);
          this.unmount(slot);
          this.mounted[slot] = made;
          made.setColor?.(this.current ? this.colorOf(slot, this.current) : (item.defaultColor ?? DEFAULT_ORIGINAL_COLOR));
        } catch (e) {
          handle?.dispose();
          this.cache.release(url);
          this.missing.set(item.id, e instanceof Error ? e.message : String(e));
          console.error(e);
        }
        this.updateBodyMask();
        this.onUpdate?.();
      },
      (e) => {
        if (this.pending[slot] === item.id) delete this.pending[slot];
        this.missing.set(item.id, `nie udało się wczytać ${file}: ${e instanceof Error ? e.message : String(e)}`);
        console.error(e);
        this.onUpdate?.();
      },
    );
  }

  private colorOf(slot: VisualSlot, a: CharacterAppearanceV1): string {
    return slot === "hair" ? a.hairColor : slot === "top" ? a.topColor : a.bottomColor;
  }

  private unmount(slot: VisualSlot): void {
    const m = this.mounted[slot];
    if (!m) return;
    delete this.mounted[slot];
    m.object.removeFromParent();
    if (m.ownsGeometry) m.geometry.dispose();
    m.onRemove?.();
  }

  private updateBodyMask(): void {
    const rules: BodyHideRule[] = [];
    const ids: string[] = [];
    for (const slot of ["top", "bottom"] as const) {
      const m = this.mounted[slot];
      if (m?.item.hides) {
        rules.push(...m.item.hides);
        ids.push(m.item.id);
      }
    }
    const key = ids.sort().join("|");
    if (key === this.hiddenKey) return;
    this.hiddenKey = key;
    const geometry = this.skinned.geometry;
    if (rules.length === 0) {
      geometry.setIndex(this.originalIndex);
      this.bodyHidden = 0;
      return;
    }
    let attr = this.indexVariants.get(key);
    if (!attr) {
      const src = this.body.indices;
      const keep: number[] = [];
      for (let t = 0; t < src.length / 3; t++) {
        const [a, b, c] = this.triangleRegions[t];
        const hidden = anyRuleHides(rules, { regions: [a, b, c], cx: this.triangleProbe[t * 2], cy: this.triangleProbe[t * 2 + 1] });
        if (!hidden) keep.push(src[t * 3], src[t * 3 + 1], src[t * 3 + 2]);
      }
      const array = this.originalIndex.array instanceof Uint16Array ? new Uint16Array(keep) : new Uint32Array(keep);
      attr = new THREE.BufferAttribute(array, 1);
      this.indexVariants.set(key, attr);
    }
    geometry.setIndex(attr);
    this.bodyHidden = (this.originalIndex.count - attr.count) / 3;
  }

  stats(): AppearanceStats {
    const t = (s: VisualSlot) => this.mounted[s]?.triangles ?? 0;
    return {
      hair: this.mounted.hair?.item.id ?? null,
      top: this.mounted.top?.item.id ?? null,
      bottom: this.mounted.bottom?.item.id ?? null,
      loading: VISUAL_SLOTS.map((s) => this.pending[s]).filter((id): id is string => !!id),
      missing: [...this.missing].map(([id, reason]) => ({ id, reason })),
      triangles: { hair: t("hair"), top: t("top"), bottom: t("bottom"), body: this.skinned.geometry.getIndex()!.count / 3, bodyHidden: this.bodyHidden },
      extraDrawCalls: VISUAL_SLOTS.filter((s) => this.mounted[s]).length,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const slot of VISUAL_SLOTS) delete this.pending[slot];
    for (const slot of VISUAL_SLOTS) this.unmount(slot);
    this.headMount?.removeFromParent();
    const geometry = this.skinned.geometry;
    for (const variant of this.indexVariants.values()) {
      geometry.setIndex(variant);
      geometry.dispose();
    }
    this.indexVariants.clear();
    geometry.setIndex(this.originalIndex);
    for (const m of Object.values(this.materials)) m.dispose();
  }
}
