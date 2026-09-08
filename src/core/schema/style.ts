// Render style: how the scene is drawn, not what it contains.
//
// A document says the same thing whether its lines are ruled or hand-drawn, but it
// does not make the same impression — and a figure that has to survive
// black-and-white printing needs its colour distinctions carried some other way.
// Both are presentation decisions, so neither belongs in the elements.

import { z } from 'zod';

/**
 * `clean` is the renderer as it has always been and is the default, so a document
 * without a style produces byte-identical output to before this existed.
 *
 * `sketch` jitters strokes into something hand-drawn. `mono` drops to greyscale for
 * print and for figures that must not depend on colour.
 */
export const stylePresetSchema = z.enum(['clean', 'sketch', 'mono']);

export const styleSchema = z.object({
  preset: stylePresetSchema.default('clean'),
  /**
   * Seed for the deterministic jitter. Defaults to the document id.
   *
   * Two documents with the same seed and the same element ids wobble identically,
   * which is what makes a re-render reproducible rather than merely similar.
   */
  seed: z.string().optional(),
  /** How far `sketch` may move a point, in canvas units. */
  roughness: z.number().min(0).max(8).default(1.2),
});

export type StylePreset = z.infer<typeof stylePresetSchema>;
export type RenderStyle = z.infer<typeof styleSchema>;
