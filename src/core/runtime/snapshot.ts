// The heart of clotho: the visual state of every element at a given time.
//
// Ported from the legacy engine's schema/runtime.ts, which was byte-identical in
// both reference implementations and already free of framework and DOM
// dependencies. `computeSnapshot` is what makes the whole design work — because
// the frame at time t is a pure function of (document, t), seeking, static frame
// rendering, server-side output, and editor scrubbing are all the same code path
// with no accumulated state to drift.

import type {
  Appearance,
  EntryMode,
  ExitMode,
  PropertyTrack,
  TrackValue,
} from '../schema/primitives';
import type { AnimationElement } from '../schema/elements';
import type { AnimationDocument } from '../schema/document';
import { DEFAULT_EASE, clamp, easeApply } from '../timing/ease';
import { blendValues, resolveBlendMode } from './interpolation';

/**
 * An element's resolved properties at one instant, plus transition bookkeeping.
 *
 * The `__`-prefixed fields carry entry/exit phase information for the renderer.
 * They are not element properties and never round-trip to a document.
 */
export type ElementVisualState = Record<string, unknown> & {
  visible: boolean;
  __entryProgress?: number;
  __entryMode?: EntryMode;
  __exitProgress?: number;
  __exitMode?: ExitMode;
};

export type SnapshotMap = Map<string, ElementVisualState>;

export type AppearancePhase = 'entry' | 'visible' | 'exit';

export interface ActiveAppearance {
  readonly appearance: Appearance;
  readonly phase: AppearancePhase;
  /** 0..1 within the current phase. Always 1 while fully visible. */
  readonly phaseProgress: number;
}

/** Value of a single track at `time`, clamped to the outer keyframes. */
export function trackValueAt(track: PropertyTrack, time: number): TrackValue | undefined {
  const frames = track.keyframes;
  if (frames.length === 0) return undefined;

  const first = frames[0]!;
  const last = frames[frames.length - 1]!;
  if (time <= first.time) return first.value;
  if (time >= last.time) return last.value;

  const mode = resolveBlendMode(track.interpolate, track.property);

  for (let i = 0; i < frames.length - 1; i += 1) {
    const a = frames[i]!;
    const b = frames[i + 1]!;
    if (time < a.time || time > b.time) continue;

    const span = b.time - a.time;
    // Duplicated keyframe times are legal; the later value wins outright.
    if (span <= 0) return b.value;

    const localT = (time - a.time) / span;
    const eased = easeApply(b.ease ?? DEFAULT_EASE, localT);
    return blendValues(a.value, b.value, eased, mode);
  }

  return last.value;
}

/**
 * Which appearance window contains `time`, and where within it.
 *
 * Entry and exit durations are ignored when the corresponding mode is `instant`
 * or absent, so an element with `entryDuration: 300` but no `entryMode` snaps in
 * rather than spending 300ms in a transition that renders nothing.
 */
export function activeAppearance(el: AnimationElement, time: number): ActiveAppearance | null {
  if (!el.appearances || el.appearances.length === 0) return null;

  for (const ap of el.appearances) {
    if (time < ap.start || time > ap.end) continue;

    const hasEntry = ap.entryMode !== undefined && ap.entryMode !== 'instant';
    const hasExit = ap.exitMode !== undefined && ap.exitMode !== 'instant';
    const entryEnd = ap.start + (hasEntry ? ap.entryDuration : 0);
    const exitStart = ap.end - (hasExit ? ap.exitDuration : 0);

    if (time < entryEnd) {
      const progress = entryEnd === ap.start ? 1 : (time - ap.start) / (entryEnd - ap.start);
      return { appearance: ap, phase: 'entry', phaseProgress: clamp(progress, 0, 1) };
    }
    if (time > exitStart) {
      const progress = ap.end === exitStart ? 1 : (time - exitStart) / (ap.end - exitStart);
      return { appearance: ap, phase: 'exit', phaseProgress: clamp(progress, 0, 1) };
    }
    return { appearance: ap, phase: 'visible', phaseProgress: 1 };
  }

  return null;
}

/**
 * Resolve every element's visual state at `time`.
 *
 * Visibility here is per-element and does not yet account for group inheritance —
 * a child of a hidden group still reports `visible: true`. Group semantics
 * (docs/SCHEMA-V1.md §2.1) are applied by the tree resolver in core/runtime/tree,
 * which consumes this snapshot. Keeping the two separate means this function
 * stays a straight per-element evaluation.
 */
export function computeSnapshot(doc: AnimationDocument, time: number): SnapshotMap {
  const snapshot: SnapshotMap = new Map();

  for (const el of doc.elements) {
    const state: ElementVisualState = {
      ...(el as unknown as Record<string, unknown>),
      visible: false,
    };

    for (const track of el.tracks) {
      const value = trackValueAt(track, time);
      if (value !== undefined) state[track.property] = value;
    }

    const active = activeAppearance(el, time);
    if (active) {
      state.visible = true;
      if (active.phase === 'entry' && active.appearance.entryMode) {
        state.__entryMode = active.appearance.entryMode;
        state.__entryProgress = active.phaseProgress;
      } else if (active.phase === 'exit' && active.appearance.exitMode) {
        state.__exitMode = active.appearance.exitMode;
        state.__exitProgress = active.phaseProgress;
      }
    }

    snapshot.set(el.id, state);
  }

  return snapshot;
}
