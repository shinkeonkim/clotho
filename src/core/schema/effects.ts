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
   * `bbox` frames the targets' combined box, `circle` its circumcircle, and
   * `elements` cuts the targets' own silhouettes out of the scrim.
   */
  shape: z.enum(['bbox', 'circle', 'elements']).default('bbox'),
  /** Canvas units of lit area kept around the targets. */
  padding: z.number().nonnegative().default(12),
  /** Ramp for the scrim, applied at both ends so the effect leaves no residue. */
  fadeIn: z.number().int().min(0).default(200),
});

export const effectSchema = z.discriminatedUnion('type', [
  highlightEffectSchema,
  pulseEffectSchema,
  flowEffectSchema,
  spotlightEffectSchema,
]);

export type HighlightEffect = z.infer<typeof highlightEffectSchema>;
export type PulseEffect = z.infer<typeof pulseEffectSchema>;
export type FlowEffect = z.infer<typeof flowEffectSchema>;
export type SpotlightEffect = z.infer<typeof spotlightEffectSchema>;
/** Effects that decorate a single element, which is every effect but `spotlight`. */
export type ElementEffect = HighlightEffect | PulseEffect | FlowEffect;
export type AnimationEffect = z.infer<typeof effectSchema>;
export type EffectType = AnimationEffect['type'];

/**
 * The elements an effect targets, whether it names one or many.
 *
 * Every caller that indexed effects by `elementId` needs this now that one effect
 * type carries a list. Returning an array in both cases keeps those call sites from
 * having to branch on the type.
 */
export function effectTargets(effect: AnimationEffect): readonly string[] {
  return effect.type === 'spotlight' ? effect.elementIds : [effect.elementId];
}

/** Narrow to the effects that decorate a single element. */
export function isElementEffect(effect: AnimationEffect): effect is ElementEffect {
  return effect.type !== 'spotlight';
}
