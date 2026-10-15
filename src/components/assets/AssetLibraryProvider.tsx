"use client";

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { AssetLibrary, QUALITY_PROFILES, type AssetLoadError, type QualityId } from "@/lib/assets";

const LibraryContext = createContext<AssetLibrary | null>(null);

type Props = {
  quality: QualityId;
  baseUrl?: string;
  onError?: (error: AssetLoadError) => void;
  children: ReactNode;
};

/** Jedna biblioteka zasobów na profil jakości; zmiana profilu tworzy nową bibliotekę, a poprzednia zwalnia GPU. */
export function AssetLibraryProvider({ quality, baseUrl, onError, children }: Props) {
  const library = useMemo(
    () => new AssetLibrary({ profile: QUALITY_PROFILES[quality], baseUrl, onError }),
    // onError celowo pominięty: zmiana callbacku nie powinna kasować cache modeli.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [quality, baseUrl],
  );
  useEffect(() => () => void library.dispose(), [library]);
  return <LibraryContext.Provider value={library}>{children}</LibraryContext.Provider>;
}

export function useAssetLibrary(): AssetLibrary {
  const library = useContext(LibraryContext);
  if (!library) throw new Error("useAssetLibrary wymaga AssetLibraryProvider");
  return library;
}
