// Deterministic pseudo-randomness for the sketch preset.
//
// The jitter has to look random and must not be random. A GIF baked twice must
// produce the same bytes; a frame reached by seeking must look like the same frame
// reached by playing. So every wobble is a pure function of the seed, the node's
// key, and which coordinate is being moved.
//
// The one input deliberately excluded is time. Feeding `t` into the seed is the
// obvious way to make a sketch look alive and the reliable way to make it boil: the
// strokes reshuffle every frame and the whole drawing shimmers. An element that
// moves across the stage keeps its own wobble.

/**
 * FNV-1a, 32-bit.
 *
 * Small, dependency-free, and good enough for what it feeds — this is a seed for a
 * wobble, not a hash table under adversarial load.
 */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32: a compact PRNG with a single 32-bit state word. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A generator of offsets in `[-amount, amount]`, seeded by the parts given. */
export function jitterSource(amount: number, ...parts: string[]): () => number {
  const random = mulberry32(hashString(parts.join(' ')));
  return () => (random() * 2 - 1) * amount;
}
