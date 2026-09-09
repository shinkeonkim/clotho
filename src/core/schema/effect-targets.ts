// Which elements an effect is about.
//
// Separate from ./effects.ts, which defines the zod schemas, and the separation is
// load-bearing rather than tidy. These two functions are needed by the *render*
// path — `activeEffectsByElement` has to know that a spotlight is not an
// element-shaped effect — and importing them from a module that also builds schemas
// drags zod into svg, dom, react and vue, which are supposed to receive documents
// already parsed and never pay for the validator.
//
// Types are free to come from there; values are not.

import type { AnimationEffect, ElementEffect } from './effects';

/**
 * The elements an effect targets, whether it names one or many.
 *
 * Every caller that used to index effects by `elementId` needs this now that
 * `spotlight` carries a list. Returning an array in both cases keeps those call
 * sites from having to branch on the type.
 */
export function effectTargets(effect: AnimationEffect): readonly string[] {
  return effect.type === 'spotlight' ? effect.elementIds : [effect.elementId];
}

/** Narrow to the effects that decorate a single element. */
export function isElementEffect(effect: AnimationEffect): effect is ElementEffect {
  return effect.type !== 'spotlight';
}
