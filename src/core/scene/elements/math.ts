// The `math` element.
//
// Three paths. Two are the host's choice rather than the document's: a
// `mathRenderer` typesets, and without one the TeX source is drawn as monospace so
// the frame still says what the author meant. The third is the document's own:
// `bakeMathElements` typeset it at authoring time and left the result as `path`
// children, in which case there is nothing to decide at render time.

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
  const tex = str(state, 'tex', el.tex);
  const alt = el.alt;

  let inner: SceneNode | null = null;
  if (ctx.options.mathRenderer && tex.trim() !== '') {
    // The typesetter is handed the theme-resolved color, not the authored one. It
    // has no way to know that `#18181b` is the schema default for "foreground" and
    // therefore unreadable on a dark stage, and making every host reimplement that
    // rule would guarantee some of them get it wrong.
    const authored = str(state, 'color', el.color);
    const anchor = str(state, 'textAnchor', el.textAnchor);
    inner = ctx.options.mathRenderer.render(tex, {
      fontSize: num(state, 'fontSize', el.fontSize),
      color: ctx.options.rawColors ? authored : (resolveElementColor(authored, 'text') ?? authored),
      display: str(state, 'display', el.display) === 'inline' ? 'inline' : 'block',
      // Handed over rather than applied here: the core cannot measure the subtree it
      // is about to receive, and anchoring without a width is guesswork. The
      // fallback below applies it through `text-anchor`, and bounds shift by it, so
      // a renderer that drops it puts the expression outside its own box.
      textAnchor: anchor === 'middle' || anchor === 'end' ? anchor : 'start',
    });
  }

  if (!inner) {
    // Distinguish "no typesetter here" from "this expression defeated it": the first
    // is a host configuration a reader can fix, the second is the document's problem.
    report(ctx, {
      code: 'unresolved-math',
      elementId: el.id,
      message:
        tex.trim() === ''
          ? // The renderer is never asked about an empty expression, so naming it
            // would blame it for something it did not see.
            `math "${el.id}" has an empty tex expression`
          : ctx.options.mathRenderer
            ? `math "${el.id}" could not be typeset by ${ctx.options.mathRenderer.name}; showing its source`
            : `math "${el.id}" has no mathRenderer; showing its source`,
    });
    inner = sourceFallback(el, state, ctx);
  }

  return wrap(el, transformFor(state, el), alt, [inner]);
}

/**
 * A baked expression: the children are the typeset result.
 *
 * The wrapper is identical to the unbaked one, which is the property that makes
 * baking invisible to everything downstream — same key, same transform, same
 * `aria-label` from the same `alt`, because the `math` element is still here.
 */
export function buildBakedMath(
  _ctx: SceneContext,
  el: MathElement,
  state: ElementState,
  children: readonly SceneNode[],
): SceneNode | null {
  if (children.length === 0) return null;
  return wrap(el, transformFor(state, el), el.alt, children);
}

/**
 * The wrapper's transform.
 *
 * Same composition a group uses, and it has to be: once an element can hold
 * children, `accumulatedMatrices` composes its transform for them, and anything the
 * renderer left out would put the camera's idea of where a glyph is somewhere the
 * glyph is not.
 */
function transformFor(state: ElementState, el: MathElement): string | undefined {
  const x = num(state, 'x', el.x);
  const y = num(state, 'y', el.y);
  const rotation = num(state, 'rotation', 0);
  const parts: string[] = [];
  if (x !== 0 || y !== 0) parts.push(`translate(${x} ${y})`);
  if (rotation !== 0) parts.push(`rotate(${rotation})`);
  return parts.length > 0 ? parts.join(' ') : undefined;
}

function wrap(
  el: MathElement,
  transform: string | undefined,
  alt: string | undefined,
  children: readonly SceneNode[],
): SceneNode {
  return {
    kind: 'g',
    key: el.id,
    attrs: compactAttrs({
      transform,
      role: alt ? 'img' : undefined,
      'aria-label': alt,
    }),
    children: [...children],
  };
}
