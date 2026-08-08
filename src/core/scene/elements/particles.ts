// Flow effect particles. Ported from legacy render-elements/flow-particle.tsx and
// the flow branch of its engine.
//
// One behavior widened deliberately: legacy required the target to be an `arrow`
// (`if (!baseEl || baseEl.type !== 'arrow') return null`), so a flow effect aimed at
// a `line` silently drew nothing. A line has exactly the same two endpoints, so it
// now works. The validator warns about flow on anything else, which caught eight
// such effects in the existing corpus.
//
// Particles travel the straight chord even on a curved arrow, as legacy did.
// Following the quadratic would be more correct but would change how existing
// animations look.

import type { AnimationEffect } from '../../schema/effects';
import { resolveEndpoints } from '../../geometry/anchors';
import { compactAttrs, type SceneNode } from '../nodes';
import type { SceneContext } from '../context';
import { flowProgress } from '../effect-visuals';

/** Opacity legacy drew particles at. */
const PARTICLE_OPACITY = 0.85;

/**
 * Nodes for every active flow effect.
 *
 * Particles are spaced evenly around the cycle and wrap with `% 1`, so a looping
 * animation shows a continuous stream rather than a burst per repeat.
 */
export function buildFlowParticles(ctx: SceneContext): SceneNode[] {
  const nodes: SceneNode[] = [];

  for (const effect of activeFlowEffects(ctx)) {
    const target = ctx.elementById.get(effect.elementId);
    if (!target || (target.type !== 'arrow' && target.type !== 'line')) continue;

    const state = ctx.snapshot.get(effect.elementId);
    if (!state) continue;
    // A hidden connector should not have particles running along it.
    if (ctx.visibility.get(effect.elementId) === false) continue;

    const ends = resolveEndpoints(target, state, {
      snapshot: ctx.snapshot,
      elementById: ctx.elementById,
      matrices: ctx.matrices,
    });
    if (!ends) continue;

    const cycle = flowProgress(effect, ctx.time);
    for (let index = 0; index < effect.particles; index += 1) {
      const t = (cycle + index / effect.particles) % 1;
      nodes.push({
        kind: 'circle',
        key: `${effect.id}-${index}`,
        attrs: compactAttrs({
          cx: ends.x1 + (ends.x2 - ends.x1) * t,
          cy: ends.y1 + (ends.y2 - ends.y1) * t,
          r: effect.radius,
          fill: effect.color,
          opacity: PARTICLE_OPACITY,
        }),
      });
    }
  }

  return nodes;
}

function activeFlowEffects(ctx: SceneContext): Extract<AnimationEffect, { type: 'flow' }>[] {
  const out: Extract<AnimationEffect, { type: 'flow' }>[] = [];
  for (const effects of ctx.effectsByElement.values()) {
    for (const effect of effects) {
      if (effect.type === 'flow') out.push(effect);
    }
  }
  return out;
}
