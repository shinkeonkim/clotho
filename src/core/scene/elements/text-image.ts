// text, image, path, polygon → scene nodes.
// Ported from legacy render-elements/text-image.tsx.
//
// `image` is the one converter that changed shape: it resolves an `assetId` through
// the asset registry and the host resolver (docs/SCHEMA-V1.md §2.3) instead of
// writing `src` straight into `href`. An asset that cannot be resolved draws a
// placeholder box rather than an empty `<image>`, so the layout does not shift when
// resolution lands.

import type { ImageElement, PathElement, PolygonElement, TextElement } from '../../schema/elements';
import { polygonCentroid } from '../../geometry/anchors';
import { resolveElementColor } from '../../theme/colors';
import { resolveAsset } from '../../assets/resolver';
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

export function buildText(ctx: SceneContext, el: TextElement, state: ElementState): SceneNode {
  const x = num(state, 'x');
  const y = num(state, 'y');
  const rotation = num(state, 'rotation');
  const color = str(state, 'color');
  const weight = state.fontWeight;

  return {
    kind: 'text',
    key: el.id,
    attrs: compactAttrs({
      x,
      y,
      'font-size': num(state, 'fontSize', 16),
      'font-weight': typeof weight === 'number' || typeof weight === 'string' ? weight : undefined,
      'font-family': ctx.fontFamily,
      fill: ctx.options.rawColors ? color : resolveElementColor(color, 'text'),
      'text-anchor': str(state, 'textAnchor'),
      transform: rotation ? `rotate(${rotation} ${x} ${y})` : undefined,
    }),
    content: str(state, 'content') ?? '',
  };
}

export function buildImage(ctx: SceneContext, el: ImageElement, state: ElementState): SceneNode {
  const x = num(state, 'x');
  const y = num(state, 'y');
  const width = num(state, 'width');
  const height = num(state, 'height');
  const assetId = str(state, 'assetId') ?? el.assetId;

  const resolved = resolveAsset(
    assetId,
    ctx.doc.assets,
    ctx.options.assetResolver,
    ctx.options.assetCache,
  );

  if (resolved.status !== 'resolved' || !resolved.href) {
    report(ctx, {
      code: resolved.status === 'pending' ? 'pending-asset' : 'unresolved-asset',
      elementId: el.id,
      message:
        resolved.reason ??
        `asset "${assetId}" is still resolving; drawing a placeholder for image "${el.id}"`,
    });
    // A dashed outline occupying the element's exact box: the reader sees that
    // something belongs here, and nothing moves once the asset arrives.
    return {
      kind: 'rect',
      key: el.id,
      attrs: compactAttrs({
        x,
        y,
        width,
        height,
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 1,
        'stroke-dasharray': '4 4',
        opacity: 0.4,
        role: 'img',
        'aria-label': str(state, 'alt') ?? `unresolved image ${assetId}`,
      }),
    };
  }

  const alt = str(state, 'alt');
  return {
    kind: 'image',
    key: el.id,
    attrs: compactAttrs({
      x,
      y,
      width,
      height,
      href: resolved.href,
      preserveAspectRatio: str(state, 'preserveAspectRatio'),
      opacity: num(state, 'opacity', 1),
      transform: num(state, 'rotation')
        ? `rotate(${num(state, 'rotation')} ${x + width / 2} ${y + height / 2})`
        : undefined,
      // Legacy had no accessibility path for images at all.
      ...(alt ? { role: 'img', 'aria-label': alt } : { 'aria-hidden': 'true' }),
    }),
  };
}

export function buildPath(_ctx: SceneContext, el: PathElement, state: ElementState): SceneNode {
  const x = num(state, 'x');
  const y = num(state, 'y');
  const rotation = num(state, 'rotation');
  const transform = [
    x !== 0 || y !== 0 ? `translate(${x} ${y})` : '',
    rotation ? `rotate(${rotation})` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    kind: 'path',
    key: el.id,
    attrs: compactAttrs({
      d: str(state, 'd'),
      transform: transform || undefined,
      fill: str(state, 'fill'),
      stroke: str(state, 'stroke'),
      'stroke-width': num(state, 'strokeWidth'),
      'stroke-dasharray': str(state, 'strokeDasharray'),
      opacity: num(state, 'opacity', 1),
    }),
  };
}

export function buildPolygon(
  _ctx: SceneContext,
  el: PolygonElement,
  state: ElementState,
): SceneNode {
  const points = str(state, 'points') ?? '';
  const rotation = num(state, 'rotation');
  // Rotating about the centroid keeps the shape in place; rotating about the origin
  // would swing it across the stage.
  const centroid = rotation ? polygonCentroid(points) : null;

  return {
    kind: 'polygon',
    key: el.id,
    attrs: compactAttrs({
      points,
      fill: str(state, 'fill'),
      stroke: str(state, 'stroke'),
      'stroke-width': num(state, 'strokeWidth'),
      opacity: num(state, 'opacity', 1),
      transform: centroid ? `rotate(${rotation} ${centroid.x} ${centroid.y})` : undefined,
    }),
  };
}
