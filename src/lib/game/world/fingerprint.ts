/**
 * Kanoniczna serializacja i odcisk świata. Deterministyczne na każdej platformie
 * (tylko arytmetyka całkowita i JSON.stringify liczb), bez zegara i losowości systemowej.
 */

export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const text = JSON.stringify(value);
    if (text === undefined) throw new Error("canonicalize: wartość nieserializowalna");
    return text;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
}

/** cyrb53 – szybki, stabilny hash 53-bitowy (nie kryptograficzny; chroni przed błędem, nie przed atakiem). */
export function hash53(text: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export function hashHex(text: string): string {
  return hash53(text).toString(16).padStart(14, "0");
}

export const FINGERPRINT_PATTERN = /^fp1:[0-9a-f]{14}$/;

export function fingerprintOf(value: unknown): string {
  return `fp1:${hashHex(canonicalize(value))}`;
}
