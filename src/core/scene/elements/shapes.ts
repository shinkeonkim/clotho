// rect and circle → scene nodes. Ported from legacy render-elements/shapes.tsx.
//
// Both wrap their shape in a `<g>` carrying `translate(center) rotate scale
// translate(-center)`, which is how rotation and pulse both act about the element's
// own middle. The transform string is built the same way legacy built it rather
// than through the matrix helpers, because SVG's own `transform` syntax is more
// legible in output and diffs than `matrix(...)`.

import type { CircleElement, RectElement } from '../../schema/elements';
import { resolveElementColor } from '../../theme/colors';
import { applyEffectColor, applyEffectScale, primaryShapeEffect } from '../effect-visuals';
import type { SceneNode, SceneTspan } from '../nodes';
import { compactAttrs } from '../nodes';
import type { ElementState, SceneContext } from '../context';

/** `translate(cx cy) rotate(deg) scale(s) translate(-cx -cy)`, or undefined if it is a no-op. */
export function centeredTransform(
  cx: number,
  cy: number,
  rotation: number,
  scale: number,
): string | undefined {
  if (rotation === 0 && scale === 1) return undefined;
  return `translate(${cx} ${cy}) rotate(${rotation}) scale(${scale}) translate(${-cx} ${-cy})`;
}

function num(state: ElementState, key: string, fallback = 0): number {
  const value = state[key];
  return typeof value === 'number' ? value : fallback;
}

function str(state: ElementState, key: string): string | undefined {
  const value = state[key];
  return typeof value === 'string' ? value : undefined;
}

function label(
  ctx: SceneContext,
  key: string,
  x: number,
  y: number,
  content: string,
  fontSize: number,
  color: string | undefined,
  extra: Record<string, string | number | undefined> = {},
): SceneNode {
  return {
    kind: 'text',
    key,
    attrs: compactAttrs({
      x,
      y,
      'text-anchor': 'middle',
      'font-size': fontSize,
      'font-family': ctx.fontFamily,
      fill: ctx.options.rawColors ? color : resolveElementColor(color, 'label'),
      ...extra,
    }),
    content,
  };
}

export function buildRect(ctx: SceneContext, el: RectElement, state: ElementState): SceneNode {
  const effect = primaryShapeEffect(ctx.effectsByElement.get(el.id));
  const scale = applyEffectScale(effect, ctx.time);

  const x = num(state, 'x');
  const y = num(state, 'y');
  const width = num(state, 'width');
  const height = num(state, 'height');
  const cx = x + width / 2;
  const cy = y + height / 2;
  const labelSize = num(state, 'labelSize', 14);
  const labelColor = str(state, 'labelColor');

  const children: SceneNode[] = [
    {
      kind: 'rect',
      key: 'shape',
      attrs: compactAttrs({
        x,
        y,
        width,
        height,
        rx: num(state, 'cornerRadius'),
        fill: applyEffectColor(str(state, 'fill'), effect, '#a5b4fc'),
        stroke: str(state, 'stroke'),
        'stroke-width': num(state, 'strokeWidth'),
      }),
    },
  ];

  const labelText = str(state, 'label');
  if (labelText) {
    // +5 vertically centers a single line against the box middle, as legacy did.
    children.push(
      label(ctx, 'label', cx, cy + 5, labelText, labelSize, labelColor, { 'font-weight': 600 }),
    );
  }

  const subtitle = str(state, 'subtitle');
  if (subtitle) {
    const subtitleSize = num(state, 'subtitleSize', 10);
    const lines = subtitle.split('\n');
    const spans: SceneTspan[] = lines.map((line, index) => ({
      key: `line-${index}`,
      attrs: compactAttrs({ x: cx, dy: index === 0 ? undefined : '1.2em' }),
      // A non-breaking space keeps an empty line from collapsing, so blank lines
      // in a subtitle still advance the baseline.
      content: line || ' ',
    }));
    children.push({
      kind: 'text',
      key: 'subtitle',
      attrs: compactAttrs({
        x: cx,
        y: cy + labelSize + 8,
        'text-anchor': 'middle',
        'font-size': subtitleSize,
        'font-family': ctx.fontFamily,
        fill: ctx.options.rawColors ? labelColor : resolveElementColor(labelColor, 'label'),
        opacity: 0.7,
      }),
      spans,
    });
  }

  return {
    kind: 'g',
    key: el.id,
    attrs: compactAttrs({ transform: centeredTransform(cx, cy, num(state, 'rotation'), scale) }),
    children,
  };
}

export function buildCircle(ctx: SceneContext, el: CircleElement, state: ElementState): SceneNode {
  const effect = primaryShapeEffect(ctx.effectsByElement.get(el.id));
  const scale = applyEffectScale(effect, ctx.time);

  const cx = num(state, 'cx');
  const cy = num(state, 'cy');

  const children: SceneNode[] = [
    {
      kind: 'circle',
      key: 'shape',
      attrs: compactAttrs({
        cx,
        cy,
        r: num(state, 'r'),
        fill: applyEffectColor(str(state, 'fill'), effect, '#a5b4fc'),
        stroke: str(state, 'stroke'),
        'stroke-width': num(state, 'strokeWidth'),
      }),
    },
  ];

  const labelText = str(state, 'label');
  if (labelText) {
    children.push(
      label(
        ctx,
        'label',
        cx,
        cy + 5,
        labelText,
        num(state, 'labelSize', 14),
        str(state, 'labelColor'),
        { 'font-weight': 600 },
      ),
    );
  }

  return {
    kind: 'g',
    key: el.id,
    attrs: compactAttrs({ transform: centeredTransform(cx, cy, num(state, 'rotation'), scale) }),
    children,
  };
}
