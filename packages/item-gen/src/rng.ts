/**
 * Deterministic hashing and pseudo-random generation.
 * Pure functions only: identical inputs always produce identical outputs,
 * which is required for server-replayable item generation (GDD 6.7, 6.12, AF-004).
 */

/** cyrb53 string hash -> 53-bit integer. */
export function hash53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** Hash to a fixed-width hexadecimal string (14 hex chars). */
export function hashHex(str: string): string {
  return hash53(str).toString(16).padStart(14, '0');
}

/** Build a seed string from ordered parts. */
export function seedFrom(...parts: Array<string | number>): string {
  return hashHex(parts.map(String).join('|'));
}

/** JSON stringify with sorted keys so hashes are independent of insertion order. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

/** Mulberry32-based seeded RNG. */
export class Rng {
  private s: number;
  constructor(seed: string | number) {
    this.s = (typeof seed === 'number' ? seed : hash53(seed)) >>> 0;
    if (this.s === 0) this.s = 0x9e3779b9;
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }
  int(min: number, maxInclusive: number): number {
    return Math.floor(this.range(min, maxInclusive + 1));
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length) % items.length];
  }
  shuffle<T>(items: readonly T[]): T[] {
    const a = items.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}
