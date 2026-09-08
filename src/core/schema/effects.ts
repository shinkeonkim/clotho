// Transient emphasis effects (docs/SCHEMA-V1.md §3).
//
// Usage across the 383 existing documents: pulse 1,258 · highlight 842 · flow 162.
// Effects are additive decoration keyed to a moment; they never alter an element's
// own timeline.
//
// The three legacy effects each decorate one element. `spotlight` (§2.12) is the
// first that decorates the *rest of the stage* instead, so it targets a set rather
// than a single id and carries its own base.

import { z } from 'zod';
import { idSchema } from './primitives';

const effectBase = {
  id: idSchema,
  elementId: idSchema,
  time: z.number().int().min(0),
};

export const highlightEffectSchema = z.object({
  type: z.literal('highlight'),
  ...effectBase,
  color: z.string().default('#facc15'),
  duration: z.number().int().min(0).default(500),
});

export const pulseEffectSchema = z.object({
  type: z.literal('pulse'),
  ...effectBase,
  scale: z.number().positive().default(1.12),
  duration: z.number().int().min(0).default(500),
});

export const flowEffectSchema = z.object({
  type: z.literal('flow'),
  ...effectBase,
  color: z.string().default('#facc15'),
  particles: z.number().int().min(1).max(10).default(3),
  radius: z.number().positive().default(4),
  duration: z.number().int().min(0).default(800),
});

/**
 * Dim everything except a set of elements.
 *
 * `highlight` answers "make this one stand out" by replacing its fill, which costs
 * the element its own color — a problem when color carries meaning. Spotlight
 * answers the same question by taking contrast away from everything else, so the
 * targets keep their appearance exactly.
 */
export const spotlightEffectSchema = z.object({
  type: z.literal('spotlight'),
  id: idSchema,
  /** Elements to keep lit. Plural, unlike every other effect. */
  elementIds: z.array(idSchema).min(1),
  time: z.number().int().min(0),
  duration: z.number().int().min(0).default(1200),
  /** Opacity of the scrim over everything else. 0 does nothing, 1 hides it entirely. */
  dim: z.number().min(0).max(1).default(0.7),
  /**
   * Colour of the scrim.
   *
   * Defaults to the theme token, which is a near-black in both themes: dimming
   * means darkening either way, and a light scrim over a dark stage would raise the
   * floor rather than lower it. Authored values are used as given, which is how a
   * document tints the surround — a blue-black for a night scene, a sepia for a
   * document that is otherwise warm.
   */
  dimColor: z.string().optional(),
  /**
   * Opacity of a wash laid over the lit area, like a coloured gel on a real lamp.
   *
   * Zero by default, so a spotlight changes nothing about its targets unless asked.
   * The targets keep their own colours, which is the whole reason this effect
   * exists instead of `highlight`.
   */
  lit: z.number().min(0).max(1).default(0),
  /** Colour of that wash. Only meaningful when `lit` is above zero. */
  litColor: z.string().default('#fde68a'),
  /**
   * `bbox` frames the targets' combined box, `circle` its circumcircle, and
   * `elements` cuts the targets' own silhouettes out of the scrim.
   */
  shape: z.enum(['bbox', 'circle', 'elements']).default('bbox'),
  /** Canvas units of lit area kept around the targets. */
  padding: z.number().nonnegative().default(12),
  /** Ramp for the scrim, applied at both ends so the effect leaves no residue. */
  fadeIn: z.number().int().min(0).default(200),
});

/**
 * Leave a visible track behind a moving element.
 *
 * Movement is often the information — a sorting cursor sweeping an array, a search
 * visiting nodes, two pointers closing on each other — and a still frame loses all
 * of it. Which means a GIF thumbnail, a screenshot, and a reader who scrolled past
 * quickly see "something is somewhere" and nothing more.
 */
export const trailEffectSchema = z.object({
  type: z.literal('trail'),
  ...effectBase,
  duration: z.number().int().min(0).default(3000),
  /** How far back to look, in milliseconds. */
  window: z.number().int().positive().default(1200),
  /**
   * How many past instants to evaluate.
   *
   * Capped because each one re-evaluates the element and its ancestors, and past
   * roughly a dozen the extra points are shorter than a stroke width apart.
   */
  samples: z.number().int().min(2).max(32).default(12),
  /**
   * `auto` joins the samples with a line unless the element's position steps, in
   * which case it draws them as dots — connecting the samples of a teleporting
   * element would draw a path it never travelled.
   */
  mode: z.enum(['auto', 'path', 'dots']).default('auto'),
  /** Older samples grow more transparent. */
  fade: z.boolean().default(true),
  color: z.string().default('#94a3b8'),
  width: z.number().positive().default(2),
});

export const effectSchema = z.discriminatedUnion('type', [
  highlightEffectSchema,
  pulseEffectSchema,
  flowEffectSchema,
  spotlightEffectSchema,
  trailEffectSchema,
]);

export type HighlightEffect = z.infer<typeof highlightEffectSchema>;
export type PulseEffect = z.infer<typeof pulseEffectSchema>;
export type FlowEffect = z.infer<typeof flowEffectSchema>;
export type SpotlightEffect = z.infer<typeof spotlightEffectSchema>;
export type TrailEffect = z.infer<typeof trailEffectSchema>;
/** Effects that decorate a single element, which is every effect but `spotlight`. */
export type ElementEffect = HighlightEffect | PulseEffect | FlowEffect | TrailEffect;
export type AnimationEffect = z.infer<typeof effectSchema>;
export type EffectType = AnimationEffect['type'];

// Re-exported so the public API is one import, while the render path can reach the
// zod-free module directly (see ./effect-targets.ts).
export { effectTargets, isElementEffect } from './effect-targets';
