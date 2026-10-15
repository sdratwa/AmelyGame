"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { mulberry32 } from "@/lib/game/core/rng";
import {
  ASSET_CATEGORIES, QUALITY_PROFILES, parseManifest, pickRock, rockPlacement, type AssetManifest, type LibraryStats,
  type Placement, type QualityId,
} from "@/lib/assets";
import { AssetBoundary, AssetLibraryProvider, ModelInstances, useAssetLibrary } from "@/components/assets";

type Layout = { id: string; x: number; z: number; placements: Placement[] };

function buildLayout(manifest: AssetManifest): Layout[] {
  const out: Layout[] = [];
  const rockIds = new Set(manifest.scaleClasses.rock.appliesTo);
  let z = 0;
  for (const category of ASSET_CATEGORIES) {
    const models = manifest.models.filter((m) => m.category === category);
    if (models.length === 0) continue;
    const rowDepth = Math.max(...models.map((m) => Math.max(m.bounds.size[0], m.bounds.size[2])));
    let x = 0;
    for (const m of models) {
      const footprint = Math.max(m.bounds.size[0], m.bounds.size[2]);
      x += footprint / 2;
      if (rockIds.has(m.id)) {
        const rnd = mulberry32(m.id.length * 97);
        const placements = (["s", "m", "l"] as const).map((cls, i) => {
          const pick = { ...pickRock(manifest, cls, rnd), modelId: m.id };
          return rockPlacement(pick, x, 0, z + i * (rowDepth * 0.5 + 2));
        });
        out.push({ id: m.id, x, z, placements });
      } else {
        out.push({ id: m.id, x, z, placements: [{ x, y: 0, z }] });
      }
      x += footprint / 2 + 1.2;
    }
    z += rowDepth + (category === "rock" ? 10 : 4);
  }
  return out;
}

function Orbit({ target }: { target: readonly [number, number, number] }) {
  const camera = useThree((s) => s.camera);
  const dom = useThree((s) => s.gl.domElement);
  const controls = useMemo(() => new OrbitControls(camera, dom), [camera, dom]);
  useEffect(() => {
    controls.target.set(target[0], target[1], target[2]);
    controls.update();
  }, [controls, target]);
  useEffect(() => () => controls.dispose(), [controls]);
  return null;
}

type RenderStats = { fps: number; calls: number; triangles: number };

function Probe({ onStats }: { onStats: (s: RenderStats) => void }) {
  const gl = useThree((s) => s.gl);
  const acc = useRef({ t: 0, frames: 0 });
  useFrame((_, dt) => {
    acc.current.t += dt;
    acc.current.frames++;
    if (acc.current.t >= 0.5) {
      onStats({ fps: Math.round(acc.current.frames / acc.current.t), calls: gl.info.render.calls, triangles: gl.info.render.triangles });
      acc.current = { t: 0, frames: 0 };
    }
  });
  return null;
}

function Scene({
  layout, stress, stressCount, focus, onRender,
}: {
  layout: Layout[];
  stress: string;
  stressCount: number;
  focus: readonly [number, number, number];
  onRender: (s: RenderStats) => void;
}) {
  const library = useAssetLibrary();
  const stressPlacements = useMemo<Placement[]>(() => {
    const rnd = mulberry32(2030);
    return Array.from({ length: stressCount }, () => ({
      x: -40 + (rnd() - 0.5) * 160, y: 0, z: -70 + (rnd() - 0.5) * 120, yaw: rnd() * Math.PI * 2, scale: 0.8 + rnd() * 0.5,
    }));
  }, [stressCount]);
  return (
    <>
      <color attach="background" args={["#bfe3f5"]} />
      <hemisphereLight args={["#ffffff", "#7aa05a", 1.1]} />
      <directionalLight position={[40, 60, 25]} intensity={2.2} castShadow={library.profile.shadows} />
      <mesh rotation-x={-Math.PI / 2} position={[40, -0.02, -10]}>
        <planeGeometry args={[400, 400]} />
        <meshLambertMaterial color="#6fa860" />
      </mesh>
      {layout.map((item) => (
        <AssetBoundary key={item.id}>
          <ModelInstances modelId={item.id} placements={item.placements} />
        </AssetBoundary>
      ))}
      {stressCount > 0 && (
        <AssetBoundary key={`${stress}:${stressCount}`}>
          <ModelInstances modelId={stress} placements={stressPlacements} />
        </AssetBoundary>
      )}
      <Orbit target={focus} />
      <Probe onStats={onRender} />
    </>
  );
}

function LibraryStatsReader({ onStats }: { onStats: (s: LibraryStats) => void }) {
  const library = useAssetLibrary();
  useEffect(() => {
    const id = setInterval(() => onStats(library.stats()), 500);
    return () => clearInterval(id);
  }, [library, onStats]);
  return null;
}

const kb = (b: number) => `${(b / 1024).toFixed(1)} KB`;

export function ModelGallery() {
  const [manifest, setManifest] = useState<AssetManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quality, setQuality] = useState<QualityId>("MEDIUM");
  const [focus, setFocus] = useState<readonly [number, number, number]>([20, 2, 0]);
  const [stressCount, setStressCount] = useState(0);
  const [stress, setStress] = useState("tree.common.1");
  const [render, setRender] = useState<RenderStats>({ fps: 0, calls: 0, triangles: 0 });
  const [lib, setLib] = useState<LibraryStats | null>(null);

  useEffect(() => {
    fetch("/models/manifest.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((raw) => setManifest(parseManifest(raw)))
      .catch((e) => setError(String(e?.message ?? e)));
  }, []);

  const layout = useMemo(() => (manifest ? buildLayout(manifest) : []), [manifest]);
  const trees = manifest?.models.filter((m) => m.category === "tree") ?? [];

  if (error) return <div className="p-6 text-red-300">Nie udało się wczytać manifestu zasobów: {error}</div>;
  if (!manifest) return <div className="p-6 text-slate-300">Wczytywanie manifestu zasobów…</div>;

  return (
    <div className="flex h-full flex-col md:flex-row">
      <aside className="max-h-[40%] w-full shrink-0 overflow-y-auto border-b border-slate-800 bg-slate-900 p-3 text-xs md:max-h-none md:w-96 md:border-r md:border-b-0">
        <h1 className="text-sm font-semibold">Galeria modeli (podgląd deweloperski)</h1>
        <p className="mt-1 text-slate-400">
          Zasoby: {manifest.totals.models} modeli, {manifest.totals.materialCount} materiałów, {manifest.totals.textureCount} tekstur,
          {" "}{(manifest.totals.totalBytesFull / 1048576).toFixed(2)} MB. Skały w trzech rozmiarach S/M/L (wariant A).
        </p>
        <div className="mt-3 flex gap-1">
          {(Object.keys(QUALITY_PROFILES) as QualityId[]).map((q) => (
            <button
              key={q}
              onClick={() => setQuality(q)}
              className={`rounded px-3 py-1 ${quality === q ? "bg-emerald-600 text-white" : "bg-slate-700 text-slate-200"}`}
            >
              {q}
            </button>
          ))}
        </div>
        <div className="mt-3 rounded bg-slate-800 p-2">
          <div className="font-medium">Test wydajności instancji</div>
          <select className="mt-1 w-full rounded bg-slate-700 p-1" value={stress} onChange={(e) => setStress(e.target.value)}>
            {trees.map((t) => (
              <option key={t.id} value={t.id}>{t.id}</option>
            ))}
          </select>
          <div className="mt-1 flex gap-1">
            {[0, 250, 1000, 3000].map((n) => (
              <button
                key={n}
                onClick={() => { setStressCount(n); if (n > 0) setFocus([-40, 4, -70]); }}
                className={`rounded px-2 py-1 ${stressCount === n ? "bg-emerald-600" : "bg-slate-700"}`}
              >
                {n === 0 ? "wył." : `${n} drzew`}
              </button>
            ))}
          </div>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 rounded bg-slate-800 p-2">
          <dt>FPS</dt><dd>{render.fps}</dd>
          <dt>Wywołania rysowania</dt><dd>{render.calls}</dd>
          <dt>Trójkąty na klatkę</dt><dd>{render.triangles.toLocaleString("pl-PL")}</dd>
          <dt>Modele / geometrie</dt><dd>{lib ? `${lib.models} / ${lib.geometries}` : "-"}</dd>
          <dt>Materiały / tekstury</dt><dd>{lib ? `${lib.materials} / ${lib.textures}` : "-"}</dd>
          <dt>Pamięć tekstur (ok.)</dt><dd>{lib ? kb(lib.approxTextureBytes) : "-"}</dd>
          <dt>Zastępniki (błędy)</dt><dd>{lib ? lib.fallbackModels : "-"}</dd>
        </dl>
        <ul className="mt-3 space-y-0.5">
          {layout.map((item) => {
            const m = manifest.models.find((x) => x.id === item.id)!;
            return (
              <li key={item.id}>
                <button
                  onClick={() => setFocus([item.x, m.bounds.size[1] / 2, item.z])}
                  className="flex w-full justify-between rounded px-2 py-1 text-left hover:bg-slate-800"
                >
                  <span>{m.id}</span>
                  <span className="text-slate-400">
                    {m.triangles} tri{m.lod[1] ? ` / LOD1 ${m.lod[1].triangles}` : ""}, {kb(m.bytes)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>
      <div className="min-h-0 flex-1">
        <AssetLibraryProvider key={quality} quality={quality}>
          <LibraryStatsReader onStats={setLib} />
          <Canvas
            camera={{ position: [20, 14, 40], fov: 50, near: 0.1, far: 600 }}
            dpr={[1, QUALITY_PROFILES[quality].pixelRatioCap]}
            gl={{ antialias: true }}
          >
            <Scene layout={layout} stress={stress} stressCount={stressCount} focus={focus} onRender={setRender} />
          </Canvas>
        </AssetLibraryProvider>
      </div>
    </div>
  );
}
