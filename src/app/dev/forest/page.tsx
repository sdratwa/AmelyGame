import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ForestPrototype } from "@/components/forest-proto/ForestPrototype";

export const metadata: Metadata = { title: "Prototyp lasu V2a (deweloperski)", robots: { index: false } };

/** Prototyp wizualny lasu 30 x 30 m (V2a). Narzędzie deweloperskie: nie jest częścią gry i nie istnieje w buildzie produkcyjnym. */
export default function ForestDevPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className="h-dvh bg-slate-950">
      <Suspense fallback={null}>
        <ForestPrototype />
      </Suspense>
    </div>
  );
}
