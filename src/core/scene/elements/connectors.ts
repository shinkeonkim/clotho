// line and arrow → scene nodes. Ported from legacy render-elements/arrows.tsx.
//
// Both set CSS `color` to their stroke so their `currentColor`-filled markers match.
// An unresolvable connector produces no node and a diagnostic, where legacy
// returned null and said nothing.

import type { ArrowElement, LineElement } from '../../schema/elements';
import type { ArrowHead } from '../../schema/primitives';
import { curveControlPoint, resolveEndpoints, type Endpoints } from '../../geometry/anchors';
import { resolveElementColor } from '../../theme/colors';
import { markerUrl } from '../markers';
import { compactAttrs, type SceneNode } from '../nodes';
import type { ElementState, SceneContext } from '../context';
import { report } from '../context';

function num(state: ElementState, key: string, fallback = 0): number {
  const value = state[key];
  return typeof value === 'number' ? value : fallback;
}

function str(state: ElementState, key: string): string | undefined {
  const value = state[key];
  return typeof value === 'string' ? value : undefined;
}

function head(state: ElementState, key: string): ArrowHead | undefined {
  const value = state[key];
  return typeof value === 'string' ? (value as ArrowHead) : undefined;
}

/** Endpoints in the connector's own space, or null with a diagnostic recorded. */
function endpointsFor(
  ctx: SceneContext,
  el: LineElement | ArrowElement,
  state: ElementState,
): Endpoints | null {
  const ends = resolveEndpoints(el, state, {
    snapshot: ctx.snapshot,
    elementById: ctx.elementById,
    matrices: ctx.matrices,
  });
  if (!ends) {
    report(ctx, {
      code: 'unresolved-connector',
      elementId: el.id,
      message: `${el.type} "${el.id}" has no resolvable endpoints and was skipped`,
    });
  }
  return ends;
}

export function buildLine(
  ctx: SceneContext,
  el: LineElement,
  state: ElementState,
): SceneNode | null {
  const ends = endpointsFor(ctx, el, state);
  if (!ends) return null;

  const stroke = str(state, 'stroke');
  return {
    kind: 'line',
    key: el.id,
    attrs: compactAttrs({
      x1: ends.x1,
      y1: ends.y1,
      x2: ends.x2,
      y2: ends.y2,
      stroke,
      'stroke-width': num(state, 'strokeWidth'),
      'stroke-dasharray': str(state, 'strokeDasharray'),
      'marker-start': markerUrl(head(state, 'headStart'), 'start'),
      'marker-end': markerUrl(head(state, 'headEnd'), 'end'),
    }),
    ...(stroke ? { style: { color: stroke } } : {}),
  };
}

/** `d` for a straight or quadratic connector. */
export function connectorPath(ends: Endpoints, curvature: number): string {
  if (curvature === 0) return `M ${ends.x1} ${ends.y1} L ${ends.x2} ${ends.y2}`;
  const control = curveControlPoint(ends, curvature);
  return `M ${ends.x1} ${ends.y1} Q ${control.x} ${control.y} ${ends.x2} ${ends.y2}`;
}

export function buildArrow(
  ctx: SceneContext,
  el: ArrowElement,
  state: ElementState,
): SceneNode | null {
  const ends = endpointsFor(ctx, el, state);
  if (!ends) return null;

  const stroke = str(state, 'stroke');
  const children: SceneNode[] = [
    {
      kind: 'path',
      key: 'shape',
      attrs: compactAttrs({
        d: connectorPath(ends, num(state, 'curvature')),
        fill: 'none',
        stroke,
        'stroke-width': num(state, 'strokeWidth'),
        'stroke-dasharray': str(state, 'strokeDasharray'),
        'marker-start': markerUrl(head(state, 'headStart'), 'start'),
        'marker-end': markerUrl(head(state, 'headEnd'), 'end'),
      }),
    },
  ];

  const labelText = str(state, 'label');
  if (labelText) {
    const labelColor = str(state, 'labelColor');
    children.push({
      kind: 'text',
      key: 'label',
      attrs: compactAttrs({
        x: (ends.x1 + ends.x2) / 2 + num(state, 'labelOffsetX'),
        y: (ends.y1 + ends.y2) / 2 + num(state, 'labelOffsetY', 4),
        'text-anchor': 'middle',
        'font-size': 12,
        'font-family': ctx.monospaceFamily,
        fill: ctx.options.rawColors ? labelColor : resolveElementColor(labelColor, 'label'),
      }),
      content: labelText,
    });
  }

  return {
    kind: 'g',
    key: el.id,
    attrs: {},
    ...(stroke ? { style: { color: stroke } } : {}),
    children,
  };
}

/** Heads referenced by every connector in the document, for marker collection. */
export function collectUsedHeads(
  ctx: SceneContext,
): { head: ArrowHead | undefined; end: 'start' | 'end' }[] {
  const used: { head: ArrowHead | undefined; end: 'start' | 'end' }[] = [];
  for (const el of ctx.doc.elements) {
    if (el.type !== 'line' && el.type !== 'arrow') continue;
    const state = ctx.snapshot.get(el.id) ?? {};
    used.push({ head: head(state, 'headStart'), end: 'start' });
    used.push({ head: head(state, 'headEnd'), end: 'end' });
  }
  return used;
}
