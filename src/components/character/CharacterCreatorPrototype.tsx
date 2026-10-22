"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { disposeScene, loadPlayerAsset, PLAYER_REQUIRED_CLIPS, type PlayerClipName } from "@/lib/assets/characters";
import { DEFAULT_APPEARANCE, clearFitOverride, cloneFit, findItem, fitToJson, loadFitOverrides, sanitizeFit, saveFitOverride, type CharacterAppearanceV1, type PartFit } from "@/lib/character";
import { AppearanceRig, type AppearanceStats } from "@/lib/forest-view/appearance/appearanceRig";
import { PlayerAnimator } from "@/lib/forest-view/playerAnimator";
import { PlayerModel } from "@/lib/forest-view/playerModel";
import { TPP_DEFAULTS } from "@/lib/tpp/config";
import { AppearanceControls } from "./AppearanceControls";

const CLIP_LABEL: Record<PlayerClipName, string> = {
  idle: "idle",
  walk: "walk",
  run: "run",
  jump: "jump",
  crouch_idle: "crouch_idle",
  crouch_walk_forward: "crouch_walk_forward",
  crouch_walk_back: "crouch_walk_back",
  crouch_sneak_left: "crouch_sneak_left",
  crouch_sneak_right: "crouch_sneak_right",
};

type Scene3D = {
  rig: AppearanceRig;
  animator: PlayerAnimator;
};

const AXES = ["X", "Y", "Z"] as const;

/** Suwak jednej osi dopasowania fryzury. */
function FitRow({ label, values, min, max, step, onChange }: { label: string; values: [number, number, number]; min: number; max: number; step: number; onChange: (axis: 0 | 1 | 2, v: number) => void }) {
  return (
    <div className="space-y-0.5">
      <div className="text-slate-300">{label}</div>
      {AXES.map((axis, i) => (
        <label key={axis} className="grid grid-cols-[1rem_1fr_3.5rem] items-center gap-1">
          <span className="text-slate-400">{axis}</span>
          <input type="range" min={min} max={max} step={step} value={values[i]} onChange={(e) => onChange(i as 0 | 1 | 2, Number(e.target.value))} className="w-full" />
          <span className="text-right tabular-nums">{values[i].toFixed(step < 0.01 ? 3 : 2)}</span>
        </label>
      ))}
    </div>
  );
}

/**
 * Kreator postaci (dev): jedna scena Three.js z `PlayerModel`, `PlayerAnimator` i `AppearanceRig` (te same klasy co w grze),
 * kamera orbitalna (lewy przycisk obrót, prawy przesunięcie, kółko przybliżenie) i panel wyboru wyglądu.
 */
export function CharacterCreatorPrototype() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene3D | null>(null);
  const [appearance, setAppearance] = useState<CharacterAppearanceV1>({ ...DEFAULT_APPEARANCE });
  const appearanceRef = useRef(appearance);
  const [clip, setClip] = useState<PlayerClipName>("idle");
  const clipRef = useRef(clip);
  const [stats, setStats] = useState<AppearanceStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [fit, setFit] = useState<PartFit | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [hairVisible, setHairVisible] = useState(true);
  /** Czy dla wybranej fryzury jest zapisane dopasowanie w przeglądarce autora (tryb deweloperski). */
  const [savedFit, setSavedFit] = useState(false);

  /** Jedna ścieżka zmiany wyglądu: dane -> rig (wymiana tylko zmienionych elementów) -> statystyki i dopasowanie. */
  const changeAppearance = useCallback((next: CharacterAppearanceV1) => {
    appearanceRef.current = next;
    setAppearance(next);
    const rig = sceneRef.current?.rig;
    if (!rig) return;
    rig.apply(next);
    setStats(rig.stats());
    setFit(next.hairStyleId ? rig.getFit(next.hairStyleId) : null);
    setSavedFit(!!next.hairStyleId && !!loadFitOverrides()[next.hairStyleId]);
  }, []);

  const chooseClip = useCallback((name: PlayerClipName) => {
    clipRef.current = name;
    setClip(name);
    sceneRef.current?.animator.setPreviewClip(name);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#1b2430");
    scene.add(new THREE.HemisphereLight("#dfe8ff", "#3a3328", 1.1));
    const sun = new THREE.DirectionalLight("#fff3da", 2.2);
    sun.position.set(2.5, 4, 3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2, near: 0.5, far: 12 });
    scene.add(sun);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(2.2, 48), new THREE.MeshStandardMaterial({ color: "#46563f", roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 50);
    camera.position.set(0, 1.25, 3.2);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.85, 0);
    controls.enableDamping = true;
    controls.minDistance = 0.6;
    controls.maxDistance = 8;
    controls.maxPolarAngle = Math.PI * 0.52;
    controls.update();

    const resize = () => {
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 1;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    let model: PlayerModel | null = null;
    let animator: PlayerAnimator | null = null;
    let rig: AppearanceRig | null = null;
    const clock = new THREE.Clock();
    const idleIntent = { crouching: false, airborne: false, speed: 0, forward: 0, right: 0 };
    const idleEvents = { justJumped: false, falling: false, grounded: true };
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(clock.getDelta(), 0.1);
      animator?.update(dt, idleIntent, idleEvents, TPP_DEFAULTS, 0.7);
      controls.update();
      renderer.render(scene, camera);
    };

    loadPlayerAsset()
      .then((asset) => {
        if (disposed) {
          disposeScene(asset.scene);
          return;
        }
        model = new PlayerModel(asset, { castShadow: true, receiveShadow: true });
        animator = new PlayerAnimator(asset, model.hipsName);
        scene.add(model.group);
        // Dopasowania zapisane wcześniej przez autora wczytują się od razu; fryzura GLB wczytuje się asynchronicznie (onUpdate odświeża panel).
        const saved = loadFitOverrides();
        rig = new AppearanceRig(asset, {
          castShadow: true,
          receiveShadow: true,
          fits: saved,
          onUpdate: () => {
            if (!disposed && rig) setStats(rig.stats());
          },
        });
        const first = appearanceRef.current.hairStyleId;
        setSavedFit(!!first && !!saved[first]);
        rig.apply(appearanceRef.current);
        animator.setPreviewClip(clipRef.current);
        sceneRef.current = { rig, animator };
        setStats(rig.stats());
        const id = appearanceRef.current.hairStyleId;
        setFit(id ? rig.getFit(id) : null);
        setReady(true);
        frame();
      })
      .catch((e) => {
        if (!disposed) setError(e instanceof Error ? e.message : String(e));
      });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      sceneRef.current = null;
      controls.dispose();
      // Kolejność: najpierw elementy wyglądu i animacje, potem model (zwalnia siatkę, szkielet i tekstury).
      rig?.dispose();
      animator?.dispose();
      model?.dispose();
      ground.geometry.dispose();
      (ground.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  const hairId = appearance.hairStyleId;
  const applyFit = useCallback(
    (next: PartFit) => {
      if (!hairId) return;
      const rig = sceneRef.current?.rig;
      if (!rig) return;
      setFit(rig.setFit(hairId, next));
    },
    [hairId],
  );
  const setUniformScale = (v: number) => {
    if (!fit) return;
    applyFit({ ...cloneFit(fit), scale: [v, v, v] });
  };
  const toggleHair = (visible: boolean) => {
    setHairVisible(visible);
    sceneRef.current?.rig.setHairVisible(visible);
  };
  const saveDev = () => {
    if (!fit || !hairId) return;
    const ok = saveFitOverride(hairId, fit);
    setSavedFit(ok);
    flash(ok ? "Zapisano dopasowanie w tej przeglądarce" : "Nie udało się zapisać (brak dostępu do pamięci przeglądarki)");
  };
  const clearDev = () => {
    if (!hairId) return;
    clearFitOverride(hairId);
    setSavedFit(false);
    if (sceneRef.current) setFit(sceneRef.current.rig.resetFit(hairId));
    flash("Usunięto zapisane dopasowanie");
  };
  const setAxis = (key: keyof PartFit) => (axis: 0 | 1 | 2, v: number) => {
    if (!fit) return;
    const next = cloneFit(fit);
    next[key][axis] = v;
    applyFit(next);
  };
  const flash = (text: string) => {
    setCopied(text);
    setTimeout(() => setCopied(null), 1800);
  };
  const copyJson = async () => {
    if (!fit || !hairId) return;
    const text = JSON.stringify({ id: hairId, fit: sanitizeFit(fit) }, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      flash("Skopiowano JSON");
    } catch {
      flash("Schowek niedostępny: skopiuj z pola poniżej");
    }
    setPasted(text);
  };
  const loadPasted = () => {
    try {
      const data = JSON.parse(pasted) as { fit?: unknown };
      applyFit(sanitizeFit(data.fit ?? data));
      flash("Wczytano dopasowanie");
    } catch {
      flash("Niepoprawny JSON");
    }
  };

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="absolute inset-0" data-testid="creator-canvas" />
      <div className="absolute left-3 top-3 max-h-[calc(100dvh-1.5rem)] w-80 space-y-3 overflow-y-auto rounded-lg bg-slate-950/80 p-3 text-xs text-slate-200 ring-1 ring-slate-700">
        <p className="font-semibold text-amber-300">Kreator postaci (dev)</p>
        <p className="text-slate-400">Lewy przycisk myszy obraca widok, prawy przesuwa, kółko przybliża. Zmiany nie są zapisywane w grze.</p>
        {!ready && !error ? <p className="text-amber-200">Wczytywanie postaci…</p> : null}
        {error ? <p className="text-red-300">{error}</p> : null}

        <section className="space-y-1">
          <p className="font-semibold text-slate-100">Wygląd</p>
          <AppearanceControls appearance={appearance} onChange={changeAppearance} compact />
          <button type="button" onClick={() => changeAppearance({ ...DEFAULT_APPEARANCE })} className="rounded bg-slate-700 px-2 py-0.5 hover:bg-slate-600">
            Przywróć domyślny
          </button>
        </section>

        <section className="space-y-1">
          <p className="font-semibold text-slate-100">Animacja</p>
          <div className="flex flex-wrap gap-1">
            {PLAYER_REQUIRED_CLIPS.map((name) => (
              <button
                key={name}
                type="button"
                data-testid={`creator-clip-${name}`}
                aria-pressed={clip === name}
                onClick={() => chooseClip(name)}
                className={`rounded px-1.5 py-0.5 ${clip === name ? "bg-amber-300 text-amber-950" : "bg-slate-700 hover:bg-slate-600"}`}
              >
                {CLIP_LABEL[name]}
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-1" data-testid="creator-fit">
          <p className="font-semibold text-slate-100">Dopasowanie fryzury (głowa)</p>
          {fit && hairId ? (
            <>
              <p className="text-slate-400">
                {findItem(hairId)?.name}: wartości to korekta dodawana do transformacji z pliku/rejestru; dotyczy tylko tej fryzury.
              </p>
              <label className="flex items-center gap-2">
                <input type="checkbox" data-testid="creator-hair-visible" checked={hairVisible} onChange={(e) => toggleHair(e.target.checked)} />
                Fryzura widoczna
              </label>
              <FitRow label="Pozycja (jednostki modelu, wysokość = 1)" values={fit.position} min={-0.1} max={0.1} step={0.001} onChange={setAxis("position")} />
              <FitRow label="Obrót (stopnie)" values={fit.rotationDeg} min={-45} max={45} step={0.5} onChange={setAxis("rotationDeg")} />
              <FitRow label="Skala (osie)" values={fit.scale} min={0.7} max={1.4} step={0.005} onChange={setAxis("scale")} />
              <label className="grid grid-cols-[auto_1fr_3.5rem] items-center gap-1">
                <span className="text-slate-300">Skala jednolita</span>
                <input type="range" data-testid="creator-uniform-scale" min={0.7} max={1.4} step={0.005} value={(fit.scale[0] + fit.scale[1] + fit.scale[2]) / 3} onChange={(e) => setUniformScale(Number(e.target.value))} className="w-full" />
                <span className="text-right tabular-nums">{((fit.scale[0] + fit.scale[1] + fit.scale[2]) / 3).toFixed(2)}</span>
              </label>
              <div className="flex flex-wrap gap-1 pt-1">
                <button type="button" onClick={() => void copyJson()} className="rounded bg-emerald-500 px-2 py-0.5 font-semibold text-emerald-950 hover:bg-emerald-400">
                  Kopiuj JSON
                </button>
                <button type="button" onClick={() => sceneRef.current && setFit(sceneRef.current.rig.resetFit(hairId))} className="rounded bg-slate-700 px-2 py-0.5 hover:bg-slate-600">
                  Reset dopasowania
                </button>
                <button type="button" data-testid="creator-fit-save" onClick={saveDev} className="rounded bg-amber-300 px-2 py-0.5 font-semibold text-amber-950 hover:bg-amber-200">
                  Zapisz (dev)
                </button>
                <button type="button" onClick={clearDev} disabled={!savedFit} className="rounded bg-slate-700 px-2 py-0.5 hover:bg-slate-600 disabled:opacity-40">
                  Usuń zapisane
                </button>
                <button type="button" onClick={loadPasted} className="rounded bg-slate-700 px-2 py-0.5 hover:bg-slate-600">
                  Wczytaj z pola
                </button>
              </div>
              <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={5} spellCheck={false} placeholder={fitToJson(fit)} className="w-full rounded border border-white/20 bg-slate-900 p-1 font-mono text-[10px]" />
              {copied ? <p className="text-emerald-300">{copied}</p> : null}
              <p className="text-slate-400">
                {savedFit ? "Zapisane dopasowanie tej fryzury jest używane w tej przeglądarce (także w grze deweloperskiej). " : ""}
                Zapis (dev) działa tylko w tej przeglądarce; żeby zostało na stałe, wklej skopiowany JSON do pola `fit` elementu w rejestrze.
              </p>
            </>
          ) : (
            <p className="text-slate-400">Wybierz fryzurę, aby ją dopasować.</p>
          )}
        </section>

        {stats ? (
          <section className="space-y-0.5 font-mono text-[11px] text-slate-300" data-testid="creator-stats">
            <p>
              włosy {stats.triangles.hair} · góra {stats.triangles.top} · dół {stats.triangles.bottom} · ciało {stats.triangles.body} tr. (ukryte {stats.triangles.bodyHidden})
            </p>
            <p>dodatkowe draw calls: {stats.extraDrawCalls}</p>
            {stats.loading.map((id) => (
              <p key={id} className="text-amber-200">
                {id}: wczytywanie pliku GLB… (poprzednia fryzura zostaje do czasu wczytania)
              </p>
            ))}
            {stats.missing.map((m) => (
              <p key={m.id} className="text-amber-300">
                {m.id}: {m.reason}
              </p>
            ))}
          </section>
        ) : null}
      </div>
    </div>
  );
}
