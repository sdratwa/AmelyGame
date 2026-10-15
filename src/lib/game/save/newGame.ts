/** Źródło losowości dla nowej gry – wstrzykiwane w testach. Zwraca uint32. */
export type Entropy = () => number;

export const cryptoEntropy: Entropy = () => {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.getRandomValues) throw new Error("Brak crypto.getRandomValues – nie można wylosować seeda świata");
  return c.getRandomValues(new Uint32Array(1))[0];
};

const hex8 = (n: number) => (n >>> 0).toString(16).padStart(8, "0");

/**
 * Seed świata i identyfikator zapisu dla nowej gry. To jedyne miejsce, w którym
 * pojawia się niedeterministyczna losowość – wynik trafia do silnika jako dane komendy.
 */
export function createNewGameParams(entropy: Entropy = cryptoEntropy): { seed: number; saveId: string } {
  const seed = entropy() >>> 0;
  const saveId = `save_${hex8(entropy())}${hex8(entropy())}`;
  return { seed, saveId };
}
