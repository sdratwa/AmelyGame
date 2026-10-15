import * as THREE from "three";
import { createInstancedModel, type AssetLibrary, type InstancedModel, type Placement } from "@/lib/assets";
import type { FoliageUniforms } from "./instancer";
import { tuneMaterial } from "./instancer";
import type { PaletteStore } from "./grading";
import type { ForestViewProfile } from "./profiles";

/**
 * TYMCZASOWY tryb diagnostyczny trawy w `/dev/forest` (parametr `?lab=grass` albo przycisk w panelu): pojedyncza kępa
 * (albo grupa) wybranego modelu trawy z bliska na płaskim podłożu, kamera orbitalna oraz przełączniki, którymi da się
 * rozdzielić możliwe przyczyny migotania: cienie, wiatr, shader bez modyfikacji, wizualizacja normalnych i stron
 * trójkątów, poprawka normalnych (`uFix`). Używa tych samych modeli, materiałów i świateł co las.
 */
export const LAB_MODELS = ["grass.common_short", "grass.common_tall", "grass.wispy_short", "grass.wispy_tall", "all"] as const;
export type LabModel = (typeof LAB_MODELS)[number];

export type LabShading = "lit" | "plain" | "normals" | "faces";
export type LabMotion = "manual" | "orbit" | "jitter";

export const LAB_SHADINGS: { id: LabShading; label: string; hint: string }[] = [
  { id: "lit", label: "Materiał lasu", hint: "ten sam materiał i shader co w lesie (paleta, wiatr, normalne)" },
  { id: "plain", label: "Bez modyfikacji shaderów", hint: "czysty MeshStandardMaterial z teksturą trawy, DoubleSide, bez wiatru i palety" },
  { id: "normals", label: "Normalne (widok)", hint: "kolor = normalna widoczna dla oświetlenia, po odwróceniu na tylnej ściance (DoubleSide)" },
  { id: "faces", label: "Strona trójkąta", hint: "zielony = przednia ścianka (CCW), czerwony = tylna; granica = miejsce przełączenia oświetlenia" },
];

export type LabOptions = {
  model: LabModel;
  /** false = jedna kępa, true = grupa kęp (jak w lesie, z różnym obrotem i skalą). */
  group: boolean;
  shading: LabShading;
  /** Poprawka normalnych (`uFix`): false odtwarza zachowanie sprzed poprawki. */
  fix: boolean;
  /** `receiveShadow` tylko dla trawy (cienie drzew i reszty zostają). */
  receiveShadow: boolean;
  /** Pionowy słupek rzucający cień na trawę (do testu cieni). */
  occluder: boolean;
  motion: LabMotion;
  /** Kąt obrotu kamery wokół kępy (stopnie), nachylenie (stopnie nad horyzontem), odległość (m). */
  azimuth: number;
  elevation: number;
  distance: number;
};

export const DEFAULT_LAB: LabOptions = {
  model: "grass.common_short",
  group: false,
  shading: "lit",
  fix: true,
  receiveShadow: true,
  occluder: false,
  motion: "manual",
  azimuth: 30,
  elevation: 25,
  distance: 1.6,
};

export const LAB_RANGES = {
  azimuth: { min: -180, max: 180, step: 0.5 },
  elevation: { min: 2, max: 88, step: 0.5 },
  distance: { min: 0.35, max: 8, step: 0.05 },
} as const;

export function sanitizeLab(o: LabOptions): LabOptions {
  const az = ((((o.azimuth + 180) % 360) + 360) % 360) - 180;
  return {
    ...o,
    azimuth: az,
    elevation: Math.min(LAB_RANGES.elevation.max, Math.max(LAB_RANGES.elevation.min, o.elevation)),
    distance: Math.min(LAB_RANGES.distance.max, Math.max(LAB_RANGES.distance.min, o.distance)),
  };
}

const FACES_VERT = /* glsl */ `
  void main() {
    #include <begin_vertex>
    #include <project_vertex>
  }
`;
const FACES_FRAG = /* glsl */ `
  void main() {
    gl_FragColor = gl_FrontFacing ? vec4(0.1, 0.85, 0.25, 1.0) : vec4(0.9, 0.1, 0.1, 1.0);
  }
`;

type Variants = { lit: THREE.Material; plain: THREE.Material };

export class GrassLab {
  readonly group = new THREE.Group();
  private readonly models: { id: string; model: InstancedModel }[] = [];
  private readonly meshes: { mesh: THREE.InstancedMesh; variants: Variants }[] = [];
  private readonly extras: THREE.Material[] = [];
  private readonly normals = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
  private readonly faces = new THREE.ShaderMaterial({ vertexShader: FACES_VERT, fragmentShader: FACES_FRAG, side: THREE.DoubleSide, toneMapped: false });
  private readonly disc: THREE.Mesh;
  private readonly occluderMesh: THREE.Mesh;
  private options: LabOptions = DEFAULT_LAB;
  private shadowsOn = false;
  private time = 0;
  readonly center: THREE.Vector3;

  constructor(
    private readonly library: AssetLibrary,
    private readonly profile: ForestViewProfile,
    private readonly uniforms: FoliageUniforms,
    private readonly palette: PaletteStore,
    center: THREE.Vector3,
  ) {
    this.center = center.clone();
    this.group.name = "grass-lab";
    this.disc = new THREE.Mesh(
      new THREE.CircleGeometry(7, 48),
      new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(86 / 255, 112 / 255, 52 / 255, THREE.SRGBColorSpace), roughness: 1, metalness: 0 }),
    );
    this.disc.rotation.x = -Math.PI / 2;
    this.disc.position.copy(this.center).setY(this.center.y - 0.01);
    this.occluderMesh = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 0.45), new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 1 }));
    this.occluderMesh.castShadow = true;
    this.group.add(this.disc, this.occluderMesh);
  }

  async init(): Promise<void> {
    const ids = LAB_MODELS.filter((m) => m !== "all");
    for (const [i, id] of ids.entries()) {
      const asset = await this.library.loadOrFallback(id);
      for (const lod of asset.levels) for (const part of lod.parts) tuneMaterial(part.material, this.uniforms, this.palette);
      const placements: Placement[] = [];
      const spread = 0.42;
      placements.push({ x: 0, y: 0, z: 0, yaw: 0.4 });
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + i;
        placements.push({ x: Math.cos(a) * spread, y: 0, z: Math.sin(a) * spread, yaw: a * 2.3, scale: 0.85 + 0.15 * ((k * 7) % 5) / 4 });
      }
      const model = createInstancedModel(asset, placements, { profile: this.profile.assets, castShadow: false, receiveShadow: true });
      this.group.add(model.group);
      this.models.push({ id, model });
      model.group.traverse((o) => {
        const mesh = o as THREE.InstancedMesh;
        if (!mesh.isInstancedMesh || !mesh.name.includes(":lod0:")) return;
        const lit = mesh.material as THREE.Material;
        const plain = new THREE.MeshStandardMaterial({
          map: (lit as THREE.MeshStandardMaterial).map ?? null,
          side: THREE.DoubleSide,
          roughness: 1,
          metalness: 0,
        });
        this.extras.push(plain);
        this.meshes.push({ mesh, variants: { lit, plain } });
      });
    }
    this.layout();
    this.apply();
  }

  /** Ustawia widoczne modele i ich pozycje w rzędzie (tryb "all") albo na środku. */
  private layout(): void {
    const o = this.options;
    const visible = this.models.filter((m) => o.model === "all" || m.id === o.model);
    const spacing = 1.6;
    this.models.forEach((m) => {
      const idx = visible.indexOf(m);
      m.model.group.visible = idx >= 0;
      const x = idx < 0 ? 0 : (idx - (visible.length - 1) / 2) * spacing;
      m.model.group.position.set(this.center.x + x, this.center.y, this.center.z);
      m.model.group.traverse((c) => {
        const mesh = c as THREE.InstancedMesh;
        if (!mesh.isInstancedMesh || !mesh.name.includes(":lod0:")) return;
        const show = idx >= 0;
        mesh.visible = show;
        mesh.count = o.group ? m.model.total : 1;
      });
    });
  }

  setOptions(options: LabOptions, shadowsOn: boolean): void {
    this.options = sanitizeLab(options);
    this.shadowsOn = shadowsOn;
    this.layout();
    this.apply();
  }

  private apply(): void {
    const o = this.options;
    this.uniforms.uFix.value = o.fix ? 1 : 0;
    for (const { mesh, variants } of this.meshes) {
      mesh.receiveShadow = this.shadowsOn && o.receiveShadow;
      mesh.material = o.shading === "lit" ? variants.lit : o.shading === "plain" ? variants.plain : o.shading === "normals" ? this.normals : this.faces;
    }
    this.disc.receiveShadow = this.shadowsOn;
    this.occluderMesh.visible = o.occluder && this.shadowsOn;
  }

  /** Słupek (płytka) ustawiany tak, by jej cień padał na środek kępy przy aktualnym słońcu. */
  placeOccluder(sunDir: THREE.Vector3): void {
    const h = 1.1;
    const horiz = Math.hypot(sunDir.x, sunDir.z) || 1;
    const k = Math.min(6, h * (horiz / Math.max(sunDir.y, 0.12)));
    const away = new THREE.Vector3(sunDir.x / horiz, 0, sunDir.z / horiz);
    const side = new THREE.Vector3(-away.z, 0, away.x);
    this.occluderMesh.position.copy(this.center).addScaledVector(away, k).addScaledVector(side, 0.3).setY(this.center.y + h);
    this.occluderMesh.rotation.y = Math.atan2(away.x, away.z);
  }

  /** Dalszy ruch kamery wg trybu: powolny obrót albo drżenie o ułamki stopnia (to właśnie wywołuje migotanie). */
  advance(dt: number): LabOptions {
    this.time += dt;
    const o = this.options;
    if (o.motion === "orbit") this.options = { ...o, azimuth: o.azimuth + 14 * dt };
    return this.options;
  }

  get current(): LabOptions {
    return this.options;
  }

  pose(): { position: THREE.Vector3; target: THREE.Vector3 } {
    const o = this.options;
    const jitter = o.motion === "jitter";
    const az = THREE.MathUtils.degToRad(o.azimuth + (jitter ? 2.5 * Math.sin(this.time * 1.7) : 0));
    const el = THREE.MathUtils.degToRad(o.elevation + (jitter ? 1.0 * Math.sin(this.time * 1.1 + 1) : 0));
    const target = this.center.clone().add(new THREE.Vector3(0, 0.3, 0));
    const r = o.distance;
    const position = target.clone().add(new THREE.Vector3(Math.sin(az) * Math.cos(el) * r, Math.sin(el) * r, Math.cos(az) * Math.cos(el) * r));
    return { position, target };
  }

  dispose(): void {
    this.uniforms.uFix.value = 1;
    for (const m of this.models) m.model.dispose();
    this.models.length = 0;
    this.meshes.length = 0;
    for (const m of this.extras) m.dispose();
    this.extras.length = 0;
    this.normals.dispose();
    this.faces.dispose();
    this.disc.geometry.dispose();
    (this.disc.material as THREE.Material).dispose();
    this.occluderMesh.geometry.dispose();
    (this.occluderMesh.material as THREE.Material).dispose();
    this.group.clear();
  }
}
