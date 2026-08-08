// How an active effect changes an element's appearance.
//
// Ported verbatim in behavior from the legacy engine's render-elements/effects.ts.

import type { AnimationEffect } from '../schema/effects';
import { clamp } from '../timing/ease';

/**
 * The one effect a shape renderer reacts to.
 *
 * Legacy picked the first `highlight` or `pulse` targeting the element and ignored
 * the rest; `flow` is drawn separately as particles along a connector. Preserved as
 * is — two overlapping pulses compounding would be a behavior change.
 */
export function primaryShapeEffect(
  effects: readonly AnimationEffect[] | undefined,
): AnimationEffect | undefined {
  return effects?.find((effect) => effect.type === 'highlight' || effect.type === 'pulse');
}

/** Highlight replaces the fill outright for the duration of the effect. */
export function applyEffectColor(
  stateColor: string | undefined,
  effect: AnimationEffect | undefined,
  defaultColor: string,
): string {
  if (effect && effect.type === 'highlight') return effect.color;
  return stateColor ?? defaultColor;
}

/**
 * Pulse scale, following a half sine so the element swells and settles back.
 *
 * `sin(πt)` is 0 at both ends, which is why a pulse leaves no residue once it is
 * over even though nothing resets the element.
 */
export function applyEffectScale(effect: AnimationEffect | undefined, currentTime: number): number {
  if (!effect || effect.type !== 'pulse') return 1;
  if (effect.duration <= 0) return 1;
  const t = clamp((currentTime - effect.time) / effect.duration, 0, 1);
  return 1 + (effect.scale - 1) * Math.sin(t * Math.PI);
}

/** Progress 0..1 through a flow effect, used to place particles. */
export function flowProgress(
  effect: Extract<AnimationEffect, { type: 'flow' }>,
  currentTime: number,
): number {
  if (effect.duration <= 0) return 0;
  return (currentTime - effect.time) / effect.duration;
}
