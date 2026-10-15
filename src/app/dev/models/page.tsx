import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ModelGallery } from "@/components/assets/ModelGallery";

export const metadata: Metadata = { title: "Galeria modeli (deweloperska)", robots: { index: false } };

/** Narzędzie deweloperskie do oceny modeli lasu (V1/V2). Nie jest częścią gry i nie jest dostępne w buildzie produkcyjnym. */
export default function ModelsDevPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className="h-dvh bg-slate-950">
      <ModelGallery />
    </div>
  );
}
