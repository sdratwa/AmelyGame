"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { use, useEffect, useMemo, useRef } from "react";
import { createInstancedModel, type Placement } from "@/lib/assets";
import { useAssetLibrary } from "./AssetLibraryProvider";

type Props = {
  modelId: string;
  /** Zmemoizowana lista: zmiana referencji przebudowuje bufory instancji. */
  placements: readonly Placement[];
  castShadow?: boolean;
  receiveShadow?: boolean;
  /** Co ile sekund przeliczać LOD względem kamery. */
  lodInterval?: number;
};

/**
 * Wszystkie instancje jednego modelu jako InstancedMesh współdzielące geometrię i materiał z biblioteki.
 * Używać wewnątrz `AssetBoundary` (Suspense + błąd). Przy błędzie ładowania rysuje oznaczony zastępnik.
 */
export function ModelInstances({ modelId, placements, castShadow, receiveShadow, lodInterval = 0.4 }: Props) {
  const library = useAssetLibrary();
  const asset = use(library.loadOrFallback(modelId));
  const camera = useThree((s) => s.camera);
  const instanced = useMemo(
    () => createInstancedModel(asset, placements, { profile: library.profile, castShadow, receiveShadow }),
    [asset, placements, library.profile, castShadow, receiveShadow],
  );
  useEffect(() => {
    instanced.updateLods(camera.position);
    return () => instanced.dispose();
  }, [instanced, camera]);
  const elapsed = useRef(0);
  useFrame((_, dt) => {
    elapsed.current += dt;
    if (elapsed.current >= lodInterval) {
      elapsed.current = 0;
      instanced.updateLods(camera.position);
    }
  });
  return <primitive object={instanced.group} />;
}
