// The `math` element.
//
// Two paths, and which one runs is the host's choice rather than the document's: a
// `mathRenderer` typesets, and without one the TeX source is drawn as monospace so
// the frame still says what the author meant.

import type { MathElement } from '../../schema/elements';
import { resolveElementColor } from '../../theme/colors';
import { compactAttrs, type SceneNode } from '../nodes';
import { report, type ElementState, type SceneContext } from '../context';

function str(state: ElementState, key: string, fallback: string): string {
  const value = state[key];
  return typeof value === 'string' ? value : fallback;
}

function num(state: ElementState, key: string, fallback: number): number {
  const value = state[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * The source text, drawn when no typesetter is available.
 *
 * Monospace because TeX source is code, and left as the author wrote it because any
 * attempt to prettify it would be a worse lie than showing the source.
 */
function sourceFallback(el: MathElement, state: ElementState, ctx: SceneContext): SceneNode {
  const fontSize = num(state, 'fontSize', el.fontSize);
  const color = str(state, 'color', el.color);
  const tex = str(state, 'tex', el.tex);
  return {
    kind: 'text',
    key: 'source',
    attrs: compactAttrs({
      x: 0,
      y: 0,
      'font-family': ctx.monospaceFamily,
      'font-size': fontSize,
      fill: ctx.options.rawColors ? color : resolveElementColor(color, 'text'),
      'text-anchor': str(state, 'textAnchor', el.textAnchor),
      'xml:space': 'preserve',
    }),
    content: tex,
  };
}

export function buildMath(ctx: SceneContext, el: MathElement, state: ElementState): SceneNode {
  const x = num(state, 'x', el.x);
  const y = num(state, 'y', el.y);
  const tex = str(state, 'tex', el.tex);
  const alt = el.alt;

  let inner: SceneNode | null = null;
  if (ctx.options.mathRenderer && tex.trim() !== '') {
    // The typesetter is handed the theme-resolved color, not the authored one. It
    // has no way to know that `#18181b` is the schema default for "foreground" and
    // therefore unreadable on a dark stage, and making every host reimplement that
    // rule would guarantee some of them get it wrong.
    const authored = str(state, 'color', el.color);
    inner = ctx.options.mathRenderer.render(tex, {
      fontSize: num(state, 'fontSize', el.fontSize),
      color: ctx.options.rawColors ? authored : (resolveElementColor(authored, 'text') ?? authored),
      display: str(state, 'display', el.display) === 'inline' ? 'inline' : 'block',
    });
  }

  if (!inner) {
    // Distinguish "no typesetter here" from "this expression defeated it": the first
    // is a host configuration a reader can fix, the second is the document's problem.
    report(ctx, {
      code: 'unresolved-math',
      elementId: el.id,
      message: ctx.options.mathRenderer
        ? `math "${el.id}" could not be typeset by ${ctx.options.mathRenderer.name}; showing its source`
        : `math "${el.id}" has no mathRenderer; showing its source`,
    });
    inner = sourceFallback(el, state, ctx);
  }

  return {
    kind: 'g',
    key: el.id,
    attrs: compactAttrs({
      transform: x !== 0 || y !== 0 ? `translate(${x} ${y})` : undefined,
      role: alt ? 'img' : undefined,
      'aria-label': alt,
    }),
    children: [inner],
  };
}
