// Entry and exit transition styling.
//
// Ported from the legacy engine's phase-styles.ts, with one required change: it
// returned a **CSS transform string with px units**
// (`"translate(10px 20px) scale(0.4)"`), which only a React `style` prop can
// consume. SVG's own `transform` attribute rejects px, so that string could not be
// reused by the SVG-string, DOM, or Vue adapters.
//
// This version returns a `Matrix`. Adapters serialize it however they like — SVG
// `transform="matrix(...)"` or CSS `transform: matrix(...)` — and the geometry is
// identical either way, because px equals one user unit inside an SVG.
//
// The numbers (200-unit slide distance, 0.2 zoom floor, 0.4 pop floor) are kept
// exactly as legacy had them; they are the visual identity of 383 animations.

import type { AnimationElement } from '../schema/elements';
import type { EntryMode, ExitMode } from '../schema/primitives';
import { elementCenter } from '../geometry/anchors';
import { IDENTITY, multiply, scaling, translation, type Matrix } from '../geometry/matrix';

export interface PhaseStyle {
  readonly opacity?: number;
  readonly transform?: Matrix;
}

const EMPTY: PhaseStyle = {};

/** How far a slide travels, in user units. */
const SLIDE_DISTANCE = 200;
const ZOOM_FLOOR = 0.2;
const POP_FLOOR = 0.4;

type State = Record<string, unknown>;

function slideOffset(mode: EntryMode | ExitMode, amount: number): { dx: number; dy: number } {
  switch (mode) {
    case 'slide-left':
      return { dx: -SLIDE_DISTANCE * amount, dy: 0 };
    case 'slide-right':
      return { dx: SLIDE_DISTANCE * amount, dy: 0 };
    case 'slide-up':
      return { dx: 0, dy: -SLIDE_DISTANCE * amount };
    case 'slide-down':
      return { dx: 0, dy: SLIDE_DISTANCE * amount };
    default:
      return { dx: 0, dy: 0 };
  }
}

/** Scale about a point: translate to it, scale, translate back. */
function scaleAbout(cx: number, cy: number, scale: number): Matrix {
  return multiply(multiply(translation(cx, cy), scaling(scale)), translation(-cx, -cy));
}

/**
 * Style for an element `progress` of the way through its entry transition.
 *
 * `zoom` and `pop` need a center to scale about; when the element type has none
 * (a group, a code block, an unresolved connector) they degrade to a plain fade
 * rather than scaling about the origin and flying across the stage.
 */
export function entryStyle(
  mode: EntryMode,
  progress: number,
  element: AnimationElement,
  state: State,
): PhaseStyle {
  if (mode === 'instant') return EMPTY;
  if (mode === 'fade') return { opacity: progress };

  if (mode === 'zoom' || mode === 'pop') {
    const center = elementCenter(element, state);
    if (!center) return { opacity: progress };
    const floor = mode === 'pop' ? POP_FLOOR : ZOOM_FLOOR;
    const scale = floor + (1 - floor) * progress;
    return { opacity: progress, transform: scaleAbout(center.x, center.y, scale) };
  }

  const { dx, dy } = slideOffset(mode, 1 - progress);
  return { opacity: progress, transform: translation(dx, dy) };
}

/** Style for an element `progress` of the way through its exit transition. */
export function exitStyle(
  mode: ExitMode,
  progress: number,
  element: AnimationElement,
  state: State,
): PhaseStyle {
  if (mode === 'instant') return EMPTY;
  if (mode === 'fade') return { opacity: 1 - progress };

  if (mode === 'zoom' || mode === 'pop') {
    const center = elementCenter(element, state);
    if (!center) return { opacity: 1 - progress };
    const floor = mode === 'pop' ? POP_FLOOR : ZOOM_FLOOR;
    const scale = 1 - (1 - floor) * progress;
    return { opacity: 1 - progress, transform: scaleAbout(center.x, center.y, scale) };
  }

  const { dx, dy } = slideOffset(mode, progress);
  return { opacity: 1 - progress, transform: translation(dx, dy) };
}

/**
 * Pick the transition style implied by a snapshot's `__entry*` / `__exit*` fields.
 * Mirrors the branch legacy's engine had inline.
 */
export function phaseStyleFromState(element: AnimationElement, state: State): PhaseStyle {
  const entryMode = state.__entryMode as EntryMode | undefined;
  const entryProgress = state.__entryProgress as number | undefined;
  if (entryMode !== undefined && entryProgress !== undefined) {
    return entryStyle(entryMode, entryProgress, element, state);
  }
  const exitMode = state.__exitMode as ExitMode | undefined;
  const exitProgress = state.__exitProgress as number | undefined;
  if (exitMode !== undefined && exitProgress !== undefined) {
    return exitStyle(exitMode, exitProgress, element, state);
  }
  return EMPTY;
}

/** True when the style would not change rendering, so adapters can skip the wrapper. */
export function isNoopPhaseStyle(style: PhaseStyle): boolean {
  if (style.opacity !== undefined && style.opacity !== 1) return false;
  if (style.transform !== undefined && style.transform !== IDENTITY) {
    const m = style.transform;
    return m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
  }
  return true;
}
