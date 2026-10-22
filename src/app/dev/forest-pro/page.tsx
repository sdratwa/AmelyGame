import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ForestPrototype } from "@/components/forest-proto/ForestPrototype";

export const metadata: Metadata = { title: "Prototyp lasu PRO 300x300 (deweloperski)", robots: { index: false } };

/**
 * Prototyp lasu 300 x 300 m z paczką Quaternius Stylized Nature MegaKit [Pro]: 4 strefy (A jesienna łąka, B iglasty, C pustynia,
 * D mix), droga główna częściowo brukowana, test FPS przez wszystkie strefy. Narzędzie deweloperskie: nie jest częścią gry
 * i nie istnieje w buildzie produkcyjnym.
 */
export default function ForestProDevPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className="h-dvh bg-slate-950">
      <Suspense fallback={null}>
        <ForestPrototype pro />
      </Suspense>
    </div>
  );
}
