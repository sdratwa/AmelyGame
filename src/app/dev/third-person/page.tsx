import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ThirdPersonPrototype } from "@/components/forest-proto/ThirdPersonPrototype";

export const metadata: Metadata = { title: "Sterowanie trzecioosobowe TPP (deweloperskie)", robots: { index: false } };

/**
 * Prawdziwy las gry (300 x 300 m, generator v3) z dziewczynką z GLB i kamerą trzecioosobową. Narzędzie deweloperskie:
 * nie jest częścią gry i nie istnieje w buildzie produkcyjnym. Główna gra i `/dev/forest` nadal działają z oczu gracza.
 */
export default function ThirdPersonDevPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className="h-dvh bg-slate-950">
      <Suspense fallback={null}>
        <ThirdPersonPrototype />
      </Suspense>
    </div>
  );
}
