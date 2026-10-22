import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CharacterCreatorPrototype } from "@/components/character/CharacterCreatorPrototype";

export const metadata: Metadata = { title: "Kreator postaci (deweloperski)", robots: { index: false } };

/**
 * Podgląd i wybór wyglądu dziewczynki: fryzura, góra, dół, kolory, klipy animacji i dopasowanie fryzury. Narzędzie
 * deweloperskie na tych samych klasach co gra (PlayerModel, PlayerAnimator, AppearanceRig); nie zapisuje gry i nie
 * istnieje w buildzie produkcyjnym.
 */
export default function CharacterCreatorPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className="h-dvh bg-slate-950">
      <CharacterCreatorPrototype />
    </div>
  );
}
