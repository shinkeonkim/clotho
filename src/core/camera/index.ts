// The camera: (document, time) → the rectangle of canvas the viewer sees.
//
// This is the same shape of function as `computeSnapshot` — pure, no accumulated
// state — for the same reason. Seeking, static export, GIF frames and editor
// scrubbing must all agree on what is on screen, and the only way to guarantee
// that is for the answer to be a function of the time alone.
//
// The output leaves this module as a `viewBox` string, which `Scene` already
// carries as a field. That is why no adapter changes: react, vue, dom, svg and
// the resvg GIF renderer all pass `Scene.viewBox` through untouched.

import type { AnimationDocument } from '../schema/document';
import type { AnimationElement } from '../schema/elements';
import type { Camera, CameraFocus, CameraProperty, CameraTrack } from '../schema/camera';
import type { Bounds, BoundsOptions, Rect } from '../geometry/bounds';
import { padBounds } from '../geometry/bounds';
import { DEFAULT_EASE, clamp, easeApply, lerp } from '../timing/ease';
import { computeSnapshot, type SnapshotMap } from '../runtime/snapshot';
import {
  accumulatedMatrices,
  buildElementTree,
  resolveVisibility,
  type ElementTree,
} from '../runtime/tree';
import { elementsRootBounds, type BoundsContext } from '../runtime/bounds';

/** Smallest zoom the camera will resolve to. Below this the stage is meaningless. */
const MIN_ZOOM = 0.01;

export interface CameraIssue {
  readonly code: 'focus-unresolved';
  /** Index into `camera.focus`. */
  readonly focusIndex: number;
  readonly elementIds: readonly string[];
  readonly message: string;
}

/**
 * The visible rectangle in canvas coordinates, plus the values it came from.
 *
 * `x`/`y`/`width`/`height` are the viewBox. `centerX`/`centerY`/`zoom` are the
 * authored values, which an editor overlay wants to show and `strokeScaling`
 * needs.
 */
export interface CameraView extends Rect {
  readonly centerX: number;
  readonly centerY: number;
  readonly zoom: number;
  readonly issues: readonly CameraIssue[];
}

export interface CameraOptions extends BoundsOptions {
  /**
   * Degrade camera movement to cuts.
   *
   * A moving viewport is the single most reliable way to make a reader motion
   * sick, so `prefers-reduced-motion` does not merely slow it down: interpolation
   * is replaced by holding the previous value until the next keyframe.
   */
  readonly reducedMotion?: boolean;
  /**
   * A context the caller has already built for `time`.
   *
   * `buildScene` has the snapshot, tree and matrices in hand before it asks for a
   * camera; without this the camera would recompute all three every frame.
   */
  readonly frame?: CameraFrameContext;
}

/** Camera state before it is turned into a rectangle. */
interface CameraState {
  readonly centerX: number;
  readonly centerY: number;
  readonly zoom: number;
}

/**
 * Everything the focus resolver needs at one instant.
 *
 * Built per time value because a focus transition has to know what the camera was
 * doing at the moment the focus began, which is a different instant from the one
 * being rendered.
 */
export interface CameraFrameContext extends BoundsContext {
  readonly visibility: Map<string, boolean>;
}

function buildFrameContext(
  doc: AnimationDocument,
  time: number,
  tree: ElementTree,
  elementById: Map<string, AnimationElement>,
  options: CameraOptions,
): CameraFrameContext {
  const snapshot: SnapshotMap = computeSnapshot(doc, time);
  return {
    snapshot,
    tree,
    elementById,
    matrices: accumulatedMatrices(tree, snapshot),
    visibility: resolveVisibility(tree, snapshot),
    options,
  };
}

/**
 * Value of a camera track at `time`.
 *
 * Numeric only, and clamped to the outer keyframes, matching `trackValueAt`.
 * Under reduced motion the eased blend is replaced by a hold, which turns every
 * move into a cut at the next keyframe.
 */
export function cameraTrackValueAt(track: CameraTrack, time: number, cut = false): number {
  const frames = track.keyframes;
  const first = frames[0]!;
  const last = frames[frames.length - 1]!;
  if (time <= first.time) return first.value;
  if (time >= last.time) return last.value;

  for (let i = 0; i < frames.length - 1; i += 1) {
    const a = frames[i]!;
    const b = frames[i + 1]!;
    if (time < a.time || time > b.time) continue;

    const span = b.time - a.time;
    // Duplicated keyframe times are legal; the later value wins outright.
    if (span <= 0) return b.value;
    // A cut holds the previous value until the next keyframe is actually reached.
    if (cut) return time >= b.time ? b.value : a.value;

    const localT = (time - a.time) / span;
    return lerp(a.value, b.value, easeApply(b.ease ?? DEFAULT_EASE, localT));
  }

  return last.value;
}

function trackFor(camera: Camera, property: CameraProperty): CameraTrack | undefined {
  return camera.tracks.find((track) => track.property === property);
}

/** Camera state from tracks alone, with canvas-centered defaults for absent tracks. */
function baseState(doc: AnimationDocument, time: number, cut: boolean): CameraState {
  const camera = doc.camera;
  const defaults: CameraState = {
    centerX: doc.canvas.width / 2,
    centerY: doc.canvas.height / 2,
    zoom: 1,
  };
  if (!camera) return defaults;

  const zoomTrack = trackFor(camera, 'zoom');
  const xTrack = trackFor(camera, 'x');
  const yTrack = trackFor(camera, 'y');

  return {
    centerX: xTrack ? cameraTrackValueAt(xTrack, time, cut) : defaults.centerX,
    centerY: yTrack ? cameraTrackValueAt(yTrack, time, cut) : defaults.centerY,
    zoom: zoomTrack ? cameraTrackValueAt(zoomTrack, time, cut) : defaults.zoom,
  };
}

/** The camera state that frames `bounds` inside the canvas. */
function stateFromBounds(bounds: Bounds, doc: AnimationDocument, maxZoom: number): CameraState {
  const width = Math.max(bounds.width, Number.EPSILON);
  const height = Math.max(bounds.height, Number.EPSILON);
  const fit = Math.min(doc.canvas.width / width, doc.canvas.height / height);
  return {
    centerX: bounds.x + bounds.width / 2,
    centerY: bounds.y + bounds.height / 2,
    zoom: clamp(fit, MIN_ZOOM, maxZoom),
  };
}

function blendStates(from: CameraState, to: CameraState, t: number): CameraState {
  return {
    centerX: lerp(from.centerX, to.centerX, t),
    centerY: lerp(from.centerY, to.centerY, t),
    zoom: lerp(from.zoom, to.zoom, t),
  };
}

/** Focus entries in time order, keeping authored order for ties. */
function sortedFocus(camera: Camera): CameraFocus[] {
  return camera.focus
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.time - b.entry.time || a.index - b.index)
    .map(({ entry }) => entry);
}

/**
 * Resolve the camera at `time`, honouring focus entries whose index is below
 * `limit`.
 *
 * The recursion is what makes a focus transition start from wherever the camera
 * actually was: entry `i` blends from the state produced by entries `0..i-1`
 * evaluated at entry `i`'s own start time. Depth is bounded by the focus count.
 */
function resolveState(
  doc: AnimationDocument,
  time: number,
  limit: number,
  cut: boolean,
  focus: readonly CameraFocus[],
  contextAt: (time: number) => CameraFrameContext,
  issues: CameraIssue[],
  collectIssues: boolean,
): CameraState {
  let activeIndex = -1;
  for (let i = 0; i < limit; i += 1) {
    if (focus[i]!.time <= time) activeIndex = i;
  }
  if (activeIndex === -1) return baseState(doc, time, cut);

  const entry = focus[activeIndex]!;
  const ctx = contextAt(time);
  const { bounds, unresolved } = elementsRootBounds(entry.elementIds, ctx, ctx.visibility);

  if (!bounds) {
    // Nothing to frame. Hold whatever the camera was doing instead of pointing at
    // empty canvas, and say so — a silent hold is indistinguishable from a bug.
    if (collectIssues) {
      issues.push({
        code: 'focus-unresolved',
        focusIndex: activeIndex,
        elementIds: unresolved,
        message: `camera focus at ${entry.time}ms has no visible target (${unresolved.join(', ')})`,
      });
    }
    return resolveState(doc, time, activeIndex, cut, focus, contextAt, issues, false);
  }

  const target = stateFromBounds(padBounds(bounds, entry.padding), doc, entry.maxZoom);
  const from = resolveState(doc, entry.time, activeIndex, cut, focus, contextAt, issues, false);

  if (cut || entry.duration <= 0) return target;

  const progress = clamp((time - entry.time) / entry.duration, 0, 1);
  if (progress >= 1) return target;
  return blendStates(from, target, easeApply(entry.ease ?? DEFAULT_EASE, progress));
}

/**
 * The visible rectangle at `time`, or null for a document without a camera.
 *
 * Returning null rather than the full-canvas rectangle is deliberate: it lets the
 * scene builder keep emitting the exact `viewBox` string it always has, so a
 * document without a camera renders byte for byte as before.
 */
export function computeCamera(
  doc: AnimationDocument,
  time: number,
  options: CameraOptions = {},
): CameraView | null {
  const camera = doc.camera;
  if (!camera) return null;
  if (camera.tracks.length === 0 && camera.focus.length === 0) return null;

  const cut = options.reducedMotion === true;
  const issues: CameraIssue[] = [];
  const focus = sortedFocus(camera);

  let tree: ElementTree | undefined;
  let elementById: Map<string, AnimationElement> | undefined;
  const contexts = new Map<number, CameraFrameContext>();
  if (options.frame) contexts.set(time, options.frame);
  const contextAt = (at: number): CameraFrameContext => {
    const cached = contexts.get(at);
    if (cached) return cached;
    tree ??= buildElementTree(doc);
    elementById ??= new Map(doc.elements.map((el) => [el.id, el]));
    const built = buildFrameContext(doc, at, tree, elementById, options);
    contexts.set(at, built);
    return built;
  };

  const state = resolveState(doc, time, focus.length, cut, focus, contextAt, issues, true);
  const zoom = clamp(
    Number.isFinite(state.zoom) ? state.zoom : 1,
    MIN_ZOOM,
    Number.MAX_SAFE_INTEGER,
  );
  const width = doc.canvas.width / zoom;
  const height = doc.canvas.height / zoom;

  return {
    x: state.centerX - width / 2,
    y: state.centerY - height / 2,
    width,
    height,
    centerX: state.centerX,
    centerY: state.centerY,
    zoom,
    issues,
  };
}
