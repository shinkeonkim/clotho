// code → scene nodes. Ported from legacy render-elements/code.tsx.
//
// Two changes from legacy, both fixing something real:
//
//   1. The line-number gutter width came from `String(lines.length).length *
//      fontSize * 0.6`, which assumed every character is one cell wide. Hangul and
//      CJK occupy two, so any code block with Korean text mismeasured. Width now
//      comes from `estimateMonospaceWidth` (docs/ARCHITECTURE.md §6).
//   2. The tokenizer is injectable; the JavaScript one remains the default.

import type { CodeElement } from '../../schema/elements';
import { estimateMonospaceWidth } from '../../text/width';
import { applyEffectColor, applyEffectScale, primaryShapeEffect } from '../effect-visuals';
import { DEFAULT_CODE_PALETTE, javascriptHighlighter, type CodePalette } from '../highlight';
import { compactAttrs, type SceneNode, type SceneTspan } from '../nodes';
import type { ElementState, SceneContext } from '../context';
import { centeredTransform } from './shapes';

/** Height of the title bar when a title is present. */
const TITLE_HEIGHT = 26;
/** Baseline spacing between code lines. */
const LINE_HEIGHT = '1.4em';
/** Gap between the gutter and the code. */
const GUTTER_GAP = 12;

function num(state: ElementState, key: string, fallback = 0): number {
  const value = state[key];
  return typeof value === 'number' ? value : fallback;
}

function str(state: ElementState, key: string): string | undefined {
  const value = state[key];
  return typeof value === 'string' ? value : undefined;
}

export function buildCode(ctx: SceneContext, el: CodeElement, state: ElementState): SceneNode {
  const effect = primaryShapeEffect(ctx.effectsByElement.get(el.id));
  const scale = applyEffectScale(effect, ctx.time);

  const x = num(state, 'x');
  const y = num(state, 'y');
  const width = num(state, 'width');
  const height = num(state, 'height');
  const fontSize = num(state, 'fontSize', 12);
  const padding = num(state, 'padding', 12);
  const cornerRadius = num(state, 'cornerRadius', 8);
  const textColor = str(state, 'textColor') ?? '#e2e8f0';
  const title = str(state, 'title');
  const showLineNumbers = state.showLineNumbers === true;
  const language = str(state, 'language') ?? 'javascript';

  const lines = (str(state, 'content') ?? '').split('\n');
  const titleHeight = title ? TITLE_HEIGHT : 0;

  // East-Asian-aware measurement: the gutter is as wide as the widest line number.
  const gutterWidth = showLineNumbers
    ? estimateMonospaceWidth(String(lines.length), fontSize) + GUTTER_GAP
    : 0;

  const palette: CodePalette = { ...DEFAULT_CODE_PALETTE, text: textColor };
  const highlighter = ctx.options.highlighter ?? javascriptHighlighter;

  const codeX = x + padding + gutterWidth;
  const firstBaseline = y + padding + titleHeight + fontSize;

  const children: SceneNode[] = [
    {
      kind: 'rect',
      key: 'panel',
      attrs: compactAttrs({
        x,
        y,
        width,
        height,
        rx: cornerRadius,
        fill: applyEffectColor(str(state, 'fill'), effect, '#1e293b'),
        stroke: 'rgba(148, 163, 184, 0.2)',
        'stroke-width': 1,
      }),
    },
  ];

  if (title) {
    children.push({
      kind: 'g',
      key: 'title',
      attrs: {},
      children: [
        {
          kind: 'rect',
          key: 'bar',
          attrs: compactAttrs({
            x,
            y,
            width,
            height: titleHeight,
            rx: cornerRadius,
            fill: 'rgba(148, 163, 184, 0.12)',
          }),
        },
        {
          kind: 'text',
          key: 'text',
          attrs: compactAttrs({
            x: x + padding,
            y: y + 17,
            'font-size': 11,
            'font-family': ctx.monospaceFamily,
            'font-weight': 600,
            fill: '#cbd5e1',
            'letter-spacing': '0.05em',
          }),
          content: title.toUpperCase(),
        },
      ],
    });
  }

  const lineSpans: SceneTspan[] = lines.map((line, index) => {
    const tokens = highlighter.highlightLine(line, palette, language);
    const base = {
      key: `line-${index}`,
      attrs: compactAttrs({
        x: codeX,
        dy: index === 0 ? undefined : LINE_HEIGHT,
        'xml:space': 'preserve',
      }),
    };
    // A blank line needs some content or the baseline does not advance; a
    // non-breaking space is what legacy used.
    if (tokens.length === 0) return { ...base, content: ' ' };
    return {
      ...base,
      spans: tokens.map((token, tokenIndex) => ({
        key: `t-${tokenIndex}`,
        attrs: compactAttrs({ fill: token.color, 'xml:space': 'preserve' }),
        content: token.text,
      })),
    };
  });

  children.push({
    kind: 'text',
    key: 'code',
    attrs: compactAttrs({
      x: codeX,
      y: firstBaseline,
      'font-size': fontSize,
      'font-family': ctx.monospaceFamily,
      fill: textColor,
      'xml:space': 'preserve',
    }),
    spans: lineSpans,
  });

  if (showLineNumbers) {
    children.push({
      kind: 'text',
      key: 'gutter',
      attrs: compactAttrs({
        x: x + padding,
        y: firstBaseline,
        'font-size': fontSize,
        'font-family': ctx.monospaceFamily,
        fill: '#64748b',
        'text-anchor': 'end',
      }),
      spans: lines.map((_line, index) => ({
        key: `n-${index}`,
        attrs: compactAttrs({
          x: codeX - 8,
          dy: index === 0 ? undefined : LINE_HEIGHT,
        }),
        content: String(index + 1),
      })),
    });
  }

  const cx = x + width / 2;
  const cy = y + height / 2;
  return {
    kind: 'g',
    key: el.id,
    attrs: compactAttrs({ transform: centeredTransform(cx, cy, num(state, 'rotation'), scale) }),
    children,
  };
}
