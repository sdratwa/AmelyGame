import { fingerprintOf } from "../../fingerprint";
import type { WorldBase } from "../../types";
import { generateWorldV4 } from "../v4/world";

export const WORLD_GEN_V5 = 5;

/**
 * Identyfikator definicji fizyki skał wchodzący do odcisku v5. Jest ZAMROŻONY na wartości z pierwszego wydania v5:
 * pierwotna tabela kształtów (pomiar wierzchu) była błędna (postać zapadała się w skały), więc poprawiono ją w miejscu,
 * a odcisk zostaje, by istniejące zapisy v5 nadal się wczytywały. Od wydania v5 każda kolejna zmiana tabeli wymaga
 * nowej wersji generatora.
 */
const ROCK_PHYSICS_ID = "fp1:1a14c02453c63a";

/**
 * Plan, teren, położenie i ID drzew oraz skał pozostają z v4 (bit w bit). Nowość v5: skały mają profil kolizji
 * (`WorldObject.rock`: skończona wysokość, powierzchnia stania), więc da się je przeskakiwać i stawać na nich. Odcisk
 * obejmuje identyfikator definicji fizyki skał (zob. `ROCK_PHYSICS_ID`).
 */
export function generateWorldV5(seed: number): WorldBase {
  const base = generateWorldV4(seed);
  return {
    ...base,
    genVersion: WORLD_GEN_V5,
    forest: base.forest && {
      ...base.forest,
      planDigest: fingerprintOf({ previous: base.forest.planDigest, rockPhysics: ROCK_PHYSICS_ID }),
    },
  };
}
