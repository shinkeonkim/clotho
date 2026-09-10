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
    // One sample is the element itself and nothing else; both builders would also
    // reject it, but there is no reason to walk it.
    if (samples.length < 2) continue;

    const dots =
      effect.mode === 'dots' || (effect.mode === 'auto' && positionSteps(ctx, effect.elementId));
    nodes.push(...(dots ? dotNodes(effect, samples) : pathNodes(effect, samples)));
  }

  return nodes;
}

/**
 * Opacity for the piece drawn from sample `index` of `count`, oldest to newest.
 *
 * Keyed on the sample's position in the original window, not on how many pieces
 * survived thinning, so a piece says how long ago the element was there. A trail
 * that stalls therefore keeps fading out instead of resetting to full.
 */
function sampleOpacity(effect: TrailEffect, index: number, count: number): number {
  if (!effect.fade || count < 2) return 1;
  return Math.min(1, (index + 1) / (count - 1));
}

/** Below this two samples are the same place, in canvas units. */
const COINCIDENT = 0.01;

interface Sample {
  readonly point: Point;
  /** Position in the original window, which is what `sampleOpacity` reads. */
  readonly index: number;
}

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Samples far enough apart to be worth drawing, newest first, excluding the newest.
 *
 * Sampling a window at a fixed rate says nothing about how far the element moved
 * between the samples, and when it moved little or not at all the samples pile up
 * on one another. Stacked translucent dots composite: eleven samples on one spot,
 * fading from 0.08 to 1, paint a solid blob — the fade is drawn but not seen, and a
 * cursor that has stopped keeps a full-strength smear under it until the window
 * clears. So walk back from the element's current position and keep a sample only
 * once it has left the last one kept.
 *
 * Walking backwards is what makes the kept sample the *most recent* visit to that
 * spot, so the fade reads as how long ago the element was last there.
 */
function thinSamples(samples: readonly Point[], minGap: number): Sample[] {
  const kept: Sample[] = [];
  let last = samples[samples.length - 1]!;
  for (let i = samples.length - 2; i >= 0; i -= 1) {
    const point = samples[i]!;
    if (distance(point, last) < minGap) continue;
    kept.push({ point, index: i });
    last = point;
  }
  return kept.reverse();
}

/**
 * Samples with runs of coincident ones collapsed, oldest first, newest kept.
 *
 * A line has to stay joined to the element, so unlike `thinSamples` this keeps the
 * newest sample and only drops the repeats. Repeats are what a stalled element
 * produces, and a zero-length segment with a round cap is a filled dot — eleven of
 * them stacked is the same solid blob.
 */
function collapseSamples(samples: readonly Point[]): Sample[] {
  const kept: Sample[] = [];
  for (let i = 0; i < samples.length; i += 1) {
    const point = samples[i]!;
    const previous = kept[kept.length - 1];
    if (previous && distance(point, previous.point) < COINCIDENT) kept.pop();
    kept.push({ point, index: i });
  }
  return kept;
}

function dotNodes(effect: TrailEffect, samples: readonly Point[]): SceneNode[] {
  // The gap is the dot's own radius: nearer than that and the new dot would sit
  // inside the last one, adding opacity rather than distance. It also stands in for
  // the old "drop the newest sample" rule — the walk starts from the element's
  // position, so nothing is drawn underneath the element either.
  return thinSamples(samples, Math.max(effect.width, COINCIDENT)).map(({ point, index }) => ({
    kind: 'circle' as const,
    key: `${effect.id}-dot-${index}`,
    attrs: compactAttrs({
      cx: point.x,
      cy: point.y,
      r: effect.width,
      fill: effect.color,
      opacity: sampleOpacity(effect, index, samples.length),
      'pointer-events': 'none',
    }),
  }));
}

function pathNodes(effect: TrailEffect, samples: readonly Point[]): SceneNode[] {
  const points = collapseSamples(samples);
  // One point is the element standing still: there is no path to draw, and drawing
  // it anyway leaves a round-capped dot pinned under the element.
  if (points.length < 2) return [];

  const line = (from: Point, to: Point): string => `M ${from.x} ${from.y} L ${to.x} ${to.y}`;

  // Without fading the whole trail is one path; with it, each segment carries its
  // own opacity, which is the only way an SVG stroke can vary along its length
  // without a gradient the adapters would each have to define.
  if (!effect.fade) {
    return [
      {
        kind: 'path',
        key: `${effect.id}-path`,
        attrs: compactAttrs({
          d: points.map(({ point }, i) => `${i === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' '),
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

  return points.slice(1).map((to, i) => {
    const from = points[i]!;
    return {
      kind: 'path' as const,
      key: `${effect.id}-seg-${from.index}`,
      attrs: compactAttrs({
        d: line(from.point, to.point),
        fill: 'none',
        stroke: effect.color,
        'stroke-width': effect.width,
        'stroke-linecap': 'round',
        opacity: sampleOpacity(effect, from.index, samples.length),
        'pointer-events': 'none',
      }),
    };
  });
}
