// Motion trails: where the element has been.
//
// The trail is not accumulated. At time t the samples over `[t - window, t]` are
// re-evaluated from the document, so `(document, t) → frame` still holds and
// seeking backwards, exporting a still, or rendering frame 400 first all produce
// the same trail. An engine that appended to a buffer as it played would give a
// different answer depending on how the viewer got there — and would be wrong
// after every seek.
//
// The cost is re-evaluation, which is why this uses `elementRootCenterAt` rather
// than a snapshot per sample: only the element and its ancestor groups are
// evaluated, not the whole document.

import type { TrailEffect } from '../../schema/effects';
import { resolveBlendMode } from '../../runtime/interpolation';
import { ancestorChain, elementRootCenterAt } from '../../runtime/bounds';
import { activeAppearance } from '../../runtime/snapshot';
import type { Point } from '../../geometry/matrix';
import { compactAttrs, type SceneNode } from '../nodes';
import { report, type SceneContext } from '../context';

/** Position properties whose blending decides whether samples may be joined. */
const POSITION_PROPERTIES = new Set(['x', 'y', 'cx', 'cy', 'x1', 'y1', 'x2', 'y2']);

/**
 * Whether the element's position steps between keyframes rather than blending.
 *
 * A stepped element is at one place and then another, having never been in
 * between, so joining its samples would draw a route it never took. `auto` uses
 * this to choose dots instead.
 */
export function positionSteps(ctx: SceneContext, elementId: string): boolean {
  const el = ctx.elementById.get(elementId);
  if (!el) return false;
  const positionTracks = el.tracks.filter((track) => POSITION_PROPERTIES.has(track.property));
  if (positionTracks.length === 0) return false;
  return positionTracks.every(
    (track) => resolveBlendMode(track.interpolate, track.property) === 'discrete',
  );
}

/**
 * Sample times over the window, oldest first.
 *
 * `start` is clamped to the document beginning and, by the caller, to the moment
 * the element came on stage. Clamping rather than dropping the earlier samples is
 * what makes a trail appear immediately: an element two hundred milliseconds into a
 * twelve-hundred millisecond window would otherwise have one sample inside its
 * lifetime and no trail at all until the window cleared its entry.
 */
export function trailSampleTimes(effect: TrailEffect, time: number, start = 0): number[] {
  const from = Math.max(start, time - effect.window);
  if (time <= from) return [time];
  const step = (time - from) / (effect.samples - 1);
  return Array.from({ length: effect.samples }, (_, i) => from + i * step);
}

/**
 * The earliest instant the trail may reach back to: when the element and every
 * ancestor group have been continuously on stage since.
 *
 * Returns null when the element is not on stage at `time` at all.
 */
export function trailFloor(
  ctx: SceneContext,
  elementId: string,
  chain: readonly { id: string }[],
): number | null {
  const el = ctx.elementById.get(elementId);
  if (!el) return null;

  let floor = 0;
  for (const id of [elementId, ...chain.map((ancestor) => ancestor.id)]) {
    const candidate = ctx.elementById.get(id);
    if (!candidate) return null;
    // An element with no appearances is never on stage, which the visibility check
    // has already caught; one with appearances is bounded by the window holding t.
    if (candidate.appearances.length === 0) continue;
    const active = activeAppearance(candidate, ctx.time);
    if (!active) return null;
    floor = Math.max(floor, active.appearance.start);
  }
  return floor;
}

function activeTrails(ctx: SceneContext): TrailEffect[] {
  const out: TrailEffect[] = [];
  for (const bucket of ctx.effectsByElement.values()) {
    for (const effect of bucket) if (effect.type === 'trail') out.push(effect);
  }
  return out;
}

/** Nodes for every active trail effect. */
export function buildTrails(ctx: SceneContext): SceneNode[] {
  const nodes: SceneNode[] = [];

  for (const effect of activeTrails(ctx)) {
    const el = ctx.elementById.get(effect.elementId);
    if (!el) continue;

    const chain = ancestorChain(ctx.tree, effect.elementId);
    const floor = trailFloor(ctx, effect.elementId, chain);
    if (floor === null) continue;

    const samples: Point[] = [];
    for (const at of trailSampleTimes(effect, ctx.time, floor)) {
      // Instants where the element was off stage contribute nothing: a trail
      // stretching back to before an element appeared is an invention.
      const point = elementRootCenterAt(ctx.tree, effect.elementId, at, chain);
      if (point) samples.push(point);
    }

    if (samples.length === 0) {
      report(ctx, {
        code: 'trail-target',
        elementId: effect.elementId,
        message: `trail "${effect.id}" has no position for "${effect.elementId}" at ${ctx.time}ms`,
      });
      continue;
    }
    // One point is a dot on the element itself, which reads as a rendering glitch
    // rather than as a trail.
    if (samples.length < 2) continue;

    const dots =
      effect.mode === 'dots' || (effect.mode === 'auto' && positionSteps(ctx, effect.elementId));
    nodes.push(...(dots ? dotNodes(effect, samples) : pathNodes(effect, samples)));
  }

  return nodes;
}

/**
 * Opacity for drawn piece `index` of `count` samples, oldest to newest.
 *
 * Both modes draw one fewer piece than there are samples — a segment joins two, and
 * the newest dot would sit under the element itself — so the newest piece is index
 * `count - 2` and lands on a full 1.
 */
function sampleOpacity(effect: TrailEffect, index: number, count: number): number {
  if (!effect.fade || count < 2) return 1;
  return Math.min(1, (index + 1) / (count - 1));
}

function dotNodes(effect: TrailEffect, samples: readonly Point[]): SceneNode[] {
  // The newest sample sits under the element itself, so drawing it would only
  // thicken the element's own outline.
  return samples.slice(0, -1).map((point, i) => ({
    kind: 'circle' as const,
    key: `${effect.id}-dot-${i}`,
    attrs: compactAttrs({
      cx: point.x,
      cy: point.y,
      r: effect.width,
      fill: effect.color,
      opacity: sampleOpacity(effect, i, samples.length),
      'pointer-events': 'none',
    }),
  }));
}

function pathNodes(effect: TrailEffect, samples: readonly Point[]): SceneNode[] {
  const line = (points: readonly Point[]): string =>
    points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  // Without fading the whole trail is one path; with it, each segment carries its
  // own opacity, which is the only way an SVG stroke can vary along its length
  // without a gradient the adapters would each have to define.
  if (!effect.fade) {
    return [
      {
        kind: 'path',
        key: `${effect.id}-path`,
        attrs: compactAttrs({
          d: line(samples),
          fill: 'none',
          stroke: effect.color,
          'stroke-width': effect.width,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
          'pointer-events': 'none',
        }),
      },
    ];
  }

  return samples.slice(1).map((point, i) => ({
    kind: 'path' as const,
    key: `${effect.id}-seg-${i}`,
    attrs: compactAttrs({
      d: line([samples[i]!, point]),
      fill: 'none',
      stroke: effect.color,
      'stroke-width': effect.width,
      'stroke-linecap': 'round',
      opacity: sampleOpacity(effect, i, samples.length),
      'pointer-events': 'none',
    }),
  }));
}
