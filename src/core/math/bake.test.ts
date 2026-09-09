// Baking is a document transform, so it is tested as one: what comes out is a
// document that still parses, still says what the author wrote, and renders the
// typeset result without a typesetter anywhere in sight.

import { describe, expect, it } from 'bun:test';
import { animationDocumentSchema, type AnimationDocument } from '../schema/document';
import { parseDocument } from '../schema';
import { buildElementTree } from '../runtime/tree';
import { buildScene } from '../scene/build';
import { bakeMathElements, bakedGlyphId, type MathBaker } from './bake';

const whole = [{ start: 0, end: 1000, entryDuration: 0, exitDuration: 0 }];

function doc(elements: Record<string, unknown>[]): AnimationDocument {
  return animationDocumentSchema.parse({
    clothoVersion: 1,
    id: 'doc',
    duration: 1000,
    canvas: { width: 400, height: 200 },
    elements,
  });
}

const math = (over: Record<string, unknown> = {}) => ({
  type: 'math',
  id: 'eq',
  x: 20,
  y: 40,
  tex: 'e^{i\\pi}+1=0',
  alt: 'Euler identity',
  appearances: whole,
  ...over,
});

/** Deterministic stand-in for KaTeX: one path per non-space character. */
const baker: MathBaker = (element) => ({
  bakedBy: 'fake@1.0.0',
  glyphs: [...element.tex.replace(/\s/g, '')].map((ch, i) => ({
    d: `M ${i * 10} 0 h 8 v ${ch.charCodeAt(0) % 7} z`,
  })),
});

const declining: MathBaker = () => null;

describe('bakeMathElements', () => {
  it('keeps the math element, with its source and its spoken form', () => {
    const { document: out } = bakeMathElements(doc([math()]), baker);
    const original = out.elements.find((el) => el.id === 'eq');
    expect(original?.type).toBe('math');
    expect(original).toMatchObject({ tex: 'e^{i\\pi}+1=0', alt: 'Euler identity' });
  });

  it('records the typesetter that produced the result', () => {
    const { document: out, baked } = bakeMathElements(doc([math()]), baker);
    expect(baked).toEqual(['eq']);
    expect(out.elements.find((el) => el.id === 'eq')).toMatchObject({
      bakedBy: 'fake@1.0.0',
    });
  });

  it('adds the glyphs as children of the element they came from', () => {
    const { document: out } = bakeMathElements(doc([math()]), baker);
    const glyphs = out.elements.filter((el) => el.parentId === 'eq');
    expect(glyphs).toHaveLength(12);
    expect(glyphs[0]?.id).toBe(bakedGlyphId('eq', 0));
    expect(glyphs.every((el) => el.type === 'path')).toBe(true);
  });

  // Position, animation and grouping all come from the parent that is still there,
  // which is the whole reason for keeping it.
  it('leaves position and tracks on the original rather than copying them down', () => {
    const source = math({ tracks: [{ property: 'x', keyframes: [{ time: 0, value: 20 }] }] });
    const { document: out } = bakeMathElements(doc([source]), baker);
    const glyph = out.elements.find((el) => el.id === bakedGlyphId('eq', 0));
    expect(glyph).toMatchObject({ x: 0, y: 0, tracks: [] });
    expect(out.elements.find((el) => el.id === 'eq')?.tracks).toHaveLength(1);
  });

  // The one thing a child does not inherit: no appearances means never visible.
  it('copies the appearance window down, because nothing else would show the glyphs', () => {
    const { document: out } = bakeMathElements(doc([math()]), baker);
    const glyph = out.elements.find((el) => el.id === bakedGlyphId('eq', 0));
    expect(glyph?.appearances).toEqual(whole);
  });

  // Baking freezes a render-time decision, and freezing the wrong one makes a baked
  // equation invisible on a dark stage: `#18181b` is the schema default for
  // "foreground", and a path fill is never rewritten the way a text colour is.
  it('gives glyphs a theme-safe fill when the element uses the default colour', () => {
    const { document: out } = bakeMathElements(doc([math()]), baker);
    expect(out.elements.find((el) => el.id === bakedGlyphId('eq', 0))).toMatchObject({
      fill: 'var(--cloth-fg)',
    });
  });

  it('leaves an authored colour exactly as authored', () => {
    const { document: out } = bakeMathElements(doc([math({ color: '#dc2626' })]), baker);
    expect(out.elements.find((el) => el.id === bakedGlyphId('eq', 0))).toMatchObject({
      fill: '#dc2626',
    });
  });

  it('lets the typesetter colour a glyph itself', () => {
    const coloured: MathBaker = () => ({
      bakedBy: 'fake@1.0.0',
      glyphs: [{ d: 'M 0 0 h 1', fill: '#16a34a' }],
    });
    const { document: out } = bakeMathElements(doc([math()]), coloured);
    expect(out.elements.find((el) => el.id === bakedGlyphId('eq', 0))).toMatchObject({
      fill: '#16a34a',
    });
  });

  it('preserves the parent link of the math element itself', () => {
    const source = doc([
      { type: 'group', id: 'g', x: 5, y: 5, appearances: whole },
      math({ parentId: 'g' }),
    ]);
    const { document: out } = bakeMathElements(source, baker);
    expect(out.elements.find((el) => el.id === 'eq')?.parentId).toBe('g');
    expect(out.elements.find((el) => el.id === bakedGlyphId('eq', 0))?.parentId).toBe('eq');
  });

  it('leaves other elements untouched and in order', () => {
    const before = doc([
      { type: 'rect', id: 'a', x: 0, y: 0, width: 5, height: 5, appearances: whole },
      math(),
      { type: 'rect', id: 'b', x: 0, y: 0, width: 5, height: 5, appearances: whole },
    ]);
    const { document: out } = bakeMathElements(before, baker);
    const ids = out.elements.map((el) => el.id);
    expect(ids[0]).toBe('a');
    expect(ids[1]).toBe('eq');
    expect(ids.at(-1)).toBe('b');
  });

  it('reports the elements a baker declined and leaves them alone', () => {
    const { document: out, baked, skipped } = bakeMathElements(doc([math()]), declining);
    expect(baked).toEqual([]);
    expect(skipped).toEqual(['eq']);
    expect(out.elements).toHaveLength(1);
    expect(out.elements[0]).not.toHaveProperty('bakedBy');
  });

  it('treats an empty glyph list as a decline rather than an empty expression', () => {
    const empty: MathBaker = () => ({ bakedBy: 'fake@1.0.0', glyphs: [] });
    const { skipped, document: out } = bakeMathElements(doc([math()]), empty);
    expect(skipped).toEqual(['eq']);
    expect(out.elements).toHaveLength(1);
  });

  it('does nothing to a document with no math in it', () => {
    const before = doc([{ type: 'rect', id: 'a', x: 0, y: 0, width: 5, height: 5 }]);
    expect(bakeMathElements(before, baker).document.elements).toEqual(before.elements);
  });
});

describe('bakeMathElements — idempotence', () => {
  it('baking twice gives the same document as baking once', () => {
    const once = bakeMathElements(doc([math()]), baker).document;
    const twice = bakeMathElements(once, baker).document;
    expect(twice).toEqual(once);
  });

  // A build step may run after the author edited the expression, and the stale
  // glyphs from the previous run must not survive alongside the new ones.
  it('replaces the previous result rather than appending to it', () => {
    const once = bakeMathElements(doc([math()]), baker).document;
    const edited = {
      ...once,
      elements: once.elements.map((el) => (el.id === 'eq' ? { ...el, tex: 'x=1' } : el)),
    } as AnimationDocument;
    const again = bakeMathElements(edited, baker).document;
    expect(again.elements.filter((el) => el.parentId === 'eq')).toHaveLength(3);
  });

  it('does not let a baker see what a previous run recorded', () => {
    const seen: (string | undefined)[] = [];
    const spy: MathBaker = (element) => {
      seen.push((element as { bakedBy?: string }).bakedBy);
      return baker(element);
    };
    const once = bakeMathElements(doc([math()]), spy).document;
    bakeMathElements(once, spy);
    expect(seen).toEqual([undefined, undefined]);
  });
});

describe('a baked document', () => {
  it('still parses', () => {
    const { document: out } = bakeMathElements(doc([math()]), baker);
    expect(parseDocument(out).ok).toBe(true);
  });

  it('makes the math element the parent of its glyphs in the element tree', () => {
    const { document: out } = bakeMathElements(doc([math()]), baker);
    const tree = buildElementTree(out);
    expect(tree.issues).toEqual([]);
    expect(tree.byId.get('eq')?.children).toHaveLength(12);
    expect(tree.roots).toHaveLength(1);
  });

  // The point of baking: no typesetter anywhere, and no complaint about it either.
  it('renders the typeset result with no mathRenderer and no diagnostic', () => {
    const { document: out } = bakeMathElements(doc([math()]), baker);
    const scene = buildScene(out, 500);
    const svg = JSON.stringify(scene);
    expect(svg).toContain('M 0 0 h 8');
    expect(svg).not.toContain('e^{i\\\\pi}');
    expect(scene.diagnostics.some((d) => d.code === 'unresolved-math')).toBe(false);
  });

  it('keeps the accessible label on the wrapper', () => {
    const { document: out } = bakeMathElements(doc([math()]), baker);
    const scene = buildScene(out, 500);
    expect(JSON.stringify(scene)).toContain('Euler identity');
  });

  // An unbaked element is unaffected by any of this.
  it('still falls back to source text when nothing baked it', () => {
    const scene = buildScene(doc([math()]), 500);
    expect(scene.diagnostics.some((d) => d.code === 'unresolved-math')).toBe(true);
  });
});
