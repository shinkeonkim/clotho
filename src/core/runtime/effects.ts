// Active effect lookup. Ported from the legacy engine's schema/runtime.ts.

import type { AnimationDocument } from '../schema/document';
import type { AnimationEffect } from '../schema/effects';

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
 */
export function activeEffectsByElement(
  doc: AnimationDocument,
  time: number,
): Map<string, AnimationEffect[]> {
  const byElement = new Map<string, AnimationEffect[]>();
  for (const effect of activeEffects(doc, time)) {
    const bucket = byElement.get(effect.elementId);
    if (bucket) bucket.push(effect);
    else byElement.set(effect.elementId, [effect]);
  }
  return byElement;
}
