// Active effect lookup. Ported from the legacy engine's schema/runtime.ts.

import type { AnimationDocument } from '../schema/document';
import type { AnimationEffect, ElementEffect, SpotlightEffect } from '../schema/effects';
import { isElementEffect } from '../schema/effects';

/**
 * Effects whose window contains `time`.
 *
 * The window is half-open — `[time, time + duration)` — so an effect ending
 * exactly at t is already gone. Zero-duration effects therefore never fire,
 * which matches legacy and keeps a mistyped `duration: 0` visibly inert rather
 * than flickering for one frame.
 */
export function activeEffects(doc: AnimationDocument, time: number): AnimationEffect[] {
  return doc.effects.filter(
    (effect) => time >= effect.time && time < effect.time + effect.duration,
  );
}

/**
 * Active effects grouped by the element they target. The renderer looks up one
 * element at a time, so building the index once beats scanning per element.
 *
 * `spotlight` is excluded: it decorates the stage around a set of elements rather
 * than any element's own appearance, and an element converter asking "what is
 * happening to me" has nothing to do with it.
 */
export function activeEffectsByElement(
  doc: AnimationDocument,
  time: number,
): Map<string, ElementEffect[]> {
  const byElement = new Map<string, ElementEffect[]>();
  for (const effect of activeEffects(doc, time)) {
    if (!isElementEffect(effect)) continue;
    const bucket = byElement.get(effect.elementId);
    if (bucket) bucket.push(effect);
    else byElement.set(effect.elementId, [effect]);
  }
  return byElement;
}

/** Active spotlights, in document order. */
export function activeSpotlights(doc: AnimationDocument, time: number): SpotlightEffect[] {
  return activeEffects(doc, time).filter(
    (effect): effect is SpotlightEffect => effect.type === 'spotlight',
  );
}
