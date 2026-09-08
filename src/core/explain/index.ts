// Why is this value what it is, and why can I not see this element?
//
// Those are the two questions authoring actually produces, and until now neither
// had an answer better than reading the JSON and doing the interpolation in your
// head. The odd part is that the computation was already there: `computeSnapshot` is
// deterministic, takes only data, and has no side effects. It simply returned the
// result and threw the reasoning away.
//
// This lives in the core rather than in the editor, and that placement is the whole
// argument. Four callers need the same evidence — the editor's inspector, a test
// failure message, `clotho explain`, and a model editing a animation and reading back
// why its change did nothing — and only one of them has a UI. More decisively, the
// rules that produce a value (easing, interpolation mode, entry and exit phases,
// group matrices, effects that override) live here and nowhere else. An editor that
// reimplemented them would drift, and an inspector that disagrees with the renderer
// is worse than no inspector.

import type { AnimationDocument } from '../schema/document';
import type { AnimationElement } from '../schema/elements';
import type { Interpolation, PropertyTrack, TrackKeyframe } from '../schema/primitives';
import { DEFAULT_EASE, clamp, easeApply } from '../timing/ease';
import { resolveBlendMode } from '../runtime/interpolation';
import { activeAppearance, elementStateAt } from '../runtime/snapshot';
import { computeSnapshot } from '../runtime/snapshot';
import { accumulatedMatrices, buildElementTree, ancestorIds } from '../runtime/tree';
import { activeEffectsByElement } from '../runtime/effects';
import { applyEffectColor, applyEffectScale, primaryShapeEffect } from '../scene/effect-visuals';
import { elementRootBounds } from '../runtime/bounds';

/** One step in producing a value, in the order the runtime applies them. */
export interface ValueContribution {
  readonly stage: 'base' | 'track' | 'effect';
  readonly value: unknown;
  /** What did it: a track's property name, an effect's id. */
  readonly by?: string;
}

export interface TrackExplanation {
  readonly keyframeCount: number;
  /** The pair being blended, or the single clamped keyframe at the ends. */
  readonly from?: TrackKeyframe;
  readonly to?: TrackKeyframe;
  /** 0..1 through the pair, after easing. */
  readonly progress: number;
  readonly ease: string;
  readonly interpolate: Interpolation | 'auto';
  /** How the two values are blended, after `auto` has been resolved. */
  readonly blend: 'number' | 'color' | 'discrete';
  /** True at or past the last keyframe, or at or before the first. */
  readonly clamped: boolean;
}

export interface ValueExplanation {
  readonly elementId: string;
  readonly property: string;
  readonly value: unknown;
  readonly source: 'track' | 'base' | 'effect';
  readonly track?: TrackExplanation;
  readonly contributors: readonly ValueContribution[];
}

export type InvisibleReason =
  | { readonly kind: 'no-appearances' }
  | { readonly kind: 'outside-appearance'; readonly nearest?: { start: number; end: number } }
  | { readonly kind: 'parent-hidden'; readonly parentId: string }
  | { readonly kind: 'tree-issue'; readonly message: string }
  | {
      readonly kind: 'off-canvas';
      readonly bounds: { x: number; y: number; width: number; height: number };
    }
  | { readonly kind: 'zero-opacity' };

export interface ElementExplanation {
  readonly elementId: string;
  readonly type: string;
  readonly time: number;
  readonly visible: boolean;
  /**
   * Why the element is not on screen.
   *
   * First because it is the question authors actually ask. An element that is simply
   * absent gives no clue about which of half a dozen causes applied, and each has a
   * different fix.
   */
  readonly invisibleBecause: readonly InvisibleReason[];
  readonly values: readonly ValueExplanation[];
}

function trackFor(element: AnimationElement, property: string): PropertyTrack | undefined {
  return element.tracks.find((track) => track.property === property);
}

/** The keyframe pair around `time`, mirroring `trackValueAt`'s own walk. */
function locate(track: PropertyTrack, time: number): TrackExplanation {
  const frames = track.keyframes;
  const first = frames[0]!;
  const last = frames[frames.length - 1]!;
  const blend = resolveBlendMode(track.interpolate, track.property);
  const shared = {
    keyframeCount: frames.length,
    interpolate: track.interpolate ?? ('auto' as const),
    blend,
  };

  if (time <= first.time) {
    return { ...shared, from: first, to: first, progress: 0, ease: 'n/a', clamped: true };
  }
  if (time >= last.time) {
    return { ...shared, from: last, to: last, progress: 1, ease: 'n/a', clamped: true };
  }

  for (let i = 0; i < frames.length - 1; i += 1) {
    const a = frames[i]!;
    const b = frames[i + 1]!;
    if (time < a.time || time > b.time) continue;
    const span = b.time - a.time;
    if (span <= 0) {
      return { ...shared, from: a, to: b, progress: 1, ease: 'n/a', clamped: false };
    }
    const ease = b.ease ?? DEFAULT_EASE;
    return {
      ...shared,
      from: a,
      to: b,
      progress: easeApply(ease, clamp((time - a.time) / span, 0, 1)),
      ease,
      clamped: false,
    };
  }

  return { ...shared, from: last, to: last, progress: 1, ease: 'n/a', clamped: true };
}

/**
 * Where one property's value came from at `time`.
 *
 * Deliberately a second computation rather than instrumentation of the first: the
 * render path runs sixty times a second and an inspector runs when someone clicks,
 * so making the common case carry bookkeeping for the rare one would be the wrong
 * trade. The value is checked against the snapshot in the tests, which is what keeps
 * the two honest.
 */
export function explainValue(
  animation: AnimationDocument,
  time: number,
  elementId: string,
  property: string,
): ValueExplanation | null {
  const element = animation.elements.find((candidate) => candidate.id === elementId);
  if (!element) return null;

  const record = element as unknown as Record<string, unknown>;
  const authored = record[property];
  const state = elementStateAt(element, time);
  const contributors: ValueContribution[] = [];

  if (authored !== undefined) contributors.push({ stage: 'base', value: authored });

  const track = trackFor(element, property);
  let source: ValueExplanation['source'] = authored === undefined ? 'base' : 'base';
  let explanation: TrackExplanation | undefined;

  if (track) {
    explanation = locate(track, time);
    source = 'track';
    contributors.push({ stage: 'track', value: state[property], by: track.property });
  }

  // Effects override rather than blend, and they are the last word — an author
  // looking at a yellow shape that their track says should be blue needs to be told
  // it is the highlight, not left to work it out.
  const effects = activeEffectsByElement(animation, time).get(elementId) ?? [];
  const primary = primaryShapeEffect(effects);
  let value = state[property];

  if (primary && property === 'fill' && primary.type === 'highlight') {
    value = applyEffectColor(
      state[property] as string | undefined,
      primary,
      String(authored ?? ''),
    );
    contributors.push({ stage: 'effect', value, by: primary.id });
    source = 'effect';
  } else if (primary && property === '__scale' && primary.type === 'pulse') {
    value = applyEffectScale(primary, time);
    contributors.push({ stage: 'effect', value, by: primary.id });
    source = 'effect';
  }

  if (authored === undefined && !track && contributors.length === 0) return null;

  return { elementId, property, value, source, track: explanation, contributors };
}

/** Property names worth explaining: everything authored, plus everything tracked. */
function propertiesOf(element: AnimationElement): string[] {
  const record = element as unknown as Record<string, unknown>;
  const skip = new Set(['id', 'type', 'appearances', 'tracks', 'bindings', 'parentId']);
  const authored = Object.keys(record).filter((key) => !skip.has(key));
  const tracked = element.tracks.map((track) => track.property);
  return [...new Set([...authored, ...tracked])].sort();
}

/**
 * Everything known about one element at one instant, visibility first.
 *
 * The reasons are collected rather than short-circuited: an element can be both
 * outside its appearance window and inside a hidden group, and fixing one of those
 * would leave the author looking at an element that is still not there.
 */
export function explainElement(
  animation: AnimationDocument,
  time: number,
  elementId: string,
): ElementExplanation | null {
  const element = animation.elements.find((candidate) => candidate.id === elementId);
  if (!element) return null;

  const tree = buildElementTree(animation);
  const snapshot = computeSnapshot(animation, time);
  const state = snapshot.get(elementId)!;
  const reasons: InvisibleReason[] = [];

  if (element.appearances.length === 0) {
    reasons.push({ kind: 'no-appearances' });
  } else if (!activeAppearance(element, time)) {
    // The nearest window is what turns "not visible" into an actionable number.
    const nearest = [...element.appearances].sort(
      (a, b) =>
        Math.min(Math.abs(a.start - time), Math.abs(a.end - time)) -
        Math.min(Math.abs(b.start - time), Math.abs(b.end - time)),
    )[0]!;
    reasons.push({
      kind: 'outside-appearance',
      nearest: { start: nearest.start, end: nearest.end },
    });
  }

  for (const issue of tree.issues) {
    if (issue.elementId === elementId) reasons.push({ kind: 'tree-issue', message: issue.message });
  }

  for (const ancestorId of ancestorIds(tree, elementId)) {
    const ancestor = animation.elements.find((candidate) => candidate.id === ancestorId);
    if (ancestor && !activeAppearance(ancestor, time)) {
      reasons.push({ kind: 'parent-hidden', parentId: ancestorId });
    }
  }

  const opacity = state.opacity;
  if (typeof opacity === 'number' && opacity <= 0) reasons.push({ kind: 'zero-opacity' });

  // Off-canvas is checked only for elements that are otherwise on stage: reporting
  // it for something that is not showing anyway would be noise.
  if (reasons.length === 0) {
    const bounds = elementRootBounds(elementId, {
      snapshot,
      tree,
      elementById: new Map(animation.elements.map((el) => [el.id, el])),
      matrices: accumulatedMatrices(tree, snapshot),
    });
    if (
      bounds &&
      (bounds.x + bounds.width < 0 ||
        bounds.y + bounds.height < 0 ||
        bounds.x > animation.canvas.width ||
        bounds.y > animation.canvas.height)
    ) {
      reasons.push({
        kind: 'off-canvas',
        bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      });
    }
  }

  const values = propertiesOf(element)
    .map((property) => explainValue(animation, time, elementId, property))
    .filter((value): value is ValueExplanation => value !== null);

  return {
    elementId,
    type: element.type,
    time,
    visible: state.visible === true && reasons.length === 0,
    invisibleBecause: reasons,
    values,
  };
}

/** A one-line summary of a reason, for a terminal or a test message. */
export function describeReason(reason: InvisibleReason): string {
  switch (reason.kind) {
    case 'no-appearances':
      return 'it has no appearance windows, so it is never on stage';
    case 'outside-appearance':
      return reason.nearest
        ? `the time is outside every appearance window (nearest is ${reason.nearest.start}–${reason.nearest.end}ms)`
        : 'the time is outside every appearance window';
    case 'parent-hidden':
      return `its ancestor group "${reason.parentId}" is off stage, and a group takes its subtree with it`;
    case 'tree-issue':
      return `its place in the tree is broken: ${reason.message}`;
    case 'off-canvas':
      return `it is drawn outside the canvas at (${reason.bounds.x}, ${reason.bounds.y})`;
    case 'zero-opacity':
      return 'its opacity is zero';
  }
}
