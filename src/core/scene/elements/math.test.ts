// Math element tests.
//
// The interesting half is the fallback: a document must render something readable
// when the host has no typesetter, because that is the default state.

import { describe, expect, it } from 'bun:test';
import { animationDocumentSchema } from '../../schema/document';
import type { AnimationDocument } from '../../schema/document';
import { buildScene } from '../build';
import type { MathRenderer } from '../math';
import type { SceneNode, SceneText } from '../nodes';
import { measureElementBox } from '../../layout';

const ALWAYS = [{ start: 0, end: 10_000, entryDuration: 0, exitDuration: 0 }];

function animation(over: Record<string, unknown> = {}): AnimationDocument {
  return animationDocumentSchema.parse({
    clothoVersion: 1,
    id: 'math',
    duration: 10_000,
    canvas: { width: 800, height: 500 },
    elements: [
      {
        type: 'math',
        id: 'eq',
        x: 100,
        y: 200,
        tex: 'T(n) = 2T(n/2) + O(n)',
        appearances: ALWAYS,
        ...over,
      },
    ],
  });
}

const mathNode = (nodes: readonly SceneNode[]): SceneNode => nodes.find((n) => n.key === 'eq')!;
const inner = (node: SceneNode): SceneNode =>
  (node as { children: readonly SceneNode[] }).children[0]!;
/** The typeset (or fallback) subtree, narrowed to a text node for its content. */
const drawn = (nodes: readonly SceneNode[]): SceneText => inner(mathNode(nodes)) as SceneText;

/** A stand-in typesetter: enough to prove the wiring, honest about being fake. */
const fakeRenderer = (over: Partial<MathRenderer> = {}): MathRenderer => ({
  name: 'fake',
  render: (tex, options) => ({
    kind: 'text',
    key: 'typeset',
    attrs: { x: 0, y: 0, 'font-size': options.fontSize, fill: options.color },
    content: `⟨${tex}⟩`,
  }),
  ...over,
});

describe('math without a typesetter', () => {
  it('draws the TeX source and says why', () => {
    const scene = buildScene(animation(), 0);
    const text = drawn(scene.nodes);
    expect(text.kind).toBe('text');
    expect(text.content).toBe('T(n) = 2T(n/2) + O(n)');
    expect(text.attrs['font-family']).toContain('mono');

    expect(scene.diagnostics).toHaveLength(1);
    expect(scene.diagnostics[0]!.code).toBe('unresolved-math');
    expect(scene.diagnostics[0]!.message).toContain('no mathRenderer');
  });

  it('places the element at its own coordinates', () => {
    expect(mathNode(buildScene(animation(), 0).nodes).attrs.transform).toBe('translate(100 200)');
  });
});

describe('math with a typesetter', () => {
  it('uses the returned subtree and reports nothing', () => {
    const scene = buildScene(animation(), 0, { mathRenderer: fakeRenderer() });
    expect(drawn(scene.nodes).content).toBe('⟨T(n) = 2T(n/2) + O(n)⟩');
    expect(scene.diagnostics).toEqual([]);
  });

  it('passes the live font size, color and display mode through', () => {
    const seen: unknown[] = [];
    const scene = buildScene(
      animation({
        fontSize: 24,
        color: '#ff0000',
        display: 'inline',
        tracks: [
          {
            property: 'fontSize',
            keyframes: [
              { time: 0, value: 24 },
              { time: 1000, value: 48, ease: 'linear' },
            ],
          },
        ],
      }),
      500,
      {
        mathRenderer: fakeRenderer({
          render: (tex, options) => {
            seen.push(options);
            return { kind: 'text', key: 't', attrs: {}, content: tex };
          },
        }),
      },
    );
    expect(scene.diagnostics).toEqual([]);
    expect(seen[0]).toEqual({ fontSize: 36, color: '#ff0000', display: 'inline' });
  });

  it('hands the typesetter a theme-safe color rather than the raw schema default', () => {
    const seen: { color: string }[] = [];
    const capture = fakeRenderer({
      render: (tex, options) => {
        seen.push({ color: options.color });
        return { kind: 'text', key: 't', attrs: {}, content: tex };
      },
    });
    // The default #18181b is a light-theme foreground: unreadable on a dark stage,
    // and a host typesetter has no way to know that.
    buildScene(animation(), 0, { mathRenderer: capture });
    expect(seen[0]!.color).toBe('var(--cloth-fg)');

    // Static export has no stylesheet for the variable to resolve against.
    buildScene(animation(), 0, { mathRenderer: capture, rawColors: true });
    expect(seen[1]!.color).toBe('#18181b');

    // An authored color is the author's decision and passes through untouched.
    buildScene(animation({ color: '#ff0000' }), 0, { mathRenderer: capture });
    expect(seen[2]!.color).toBe('#ff0000');
  });

  it('falls back to the source when the typesetter gives up, and names it', () => {
    const scene = buildScene(animation(), 0, {
      mathRenderer: fakeRenderer({ name: 'giver-upper', render: () => null }),
    });
    expect(drawn(scene.nodes).content).toBe('T(n) = 2T(n/2) + O(n)');
    expect(scene.diagnostics[0]!.message).toContain('giver-upper');
  });

  it('does not call the typesetter for an empty expression', () => {
    let called = 0;
    buildScene(animation({ tex: '   ' }), 0, {
      mathRenderer: fakeRenderer({
        render: (tex) => {
          called += 1;
          return { kind: 'text', key: 't', attrs: {}, content: tex };
        },
      }),
    });
    expect(called).toBe(0);
  });
});

describe('math as an element', () => {
  it('exposes alt text as an accessible label', () => {
    const scene = buildScene(animation({ alt: 'T of n' }), 0);
    const wrapper = mathNode(scene.nodes);
    expect(wrapper.attrs['aria-label']).toBe('T of n');
    expect(wrapper.attrs.role).toBe('img');
  });

  it('carries no role when there is nothing to announce', () => {
    expect(mathNode(buildScene(animation(), 0).nodes).attrs.role).toBeUndefined();
  });

  it('moves with a track', () => {
    const moved = animation({
      tracks: [
        {
          property: 'x',
          keyframes: [
            { time: 0, value: 100 },
            { time: 1000, value: 300, ease: 'linear' },
          ],
        },
      ],
    });
    expect(mathNode(buildScene(moved, 500).nodes).attrs.transform).toBe('translate(200 200)');
  });

  it('follows a group transform', () => {
    const grouped = animationDocumentSchema.parse({
      clothoVersion: 1,
      id: 'math-group',
      duration: 1000,
      elements: [
        { type: 'group', id: 'g', x: 40, y: 10, appearances: ALWAYS },
        { type: 'math', id: 'eq', parentId: 'g', x: 5, y: 5, tex: 'x', appearances: ALWAYS },
      ],
    });
    const group = buildScene(grouped, 0).nodes.find((n) => n.key === 'g')!;
    expect(group.attrs.transform).toContain('translate(40 10)');
  });

  it('gets an estimated layout box from its source', () => {
    const el = animation({ fontSize: 20 }).elements[0]!;
    const box = measureElementBox(el)!;
    expect(box.width).toBeGreaterThan(0);
    expect(box.y).toBe(200 - 20);
  });

  it('shifts its layout box for middle and end anchors', () => {
    const start = measureElementBox(animation({ textAnchor: 'start' }).elements[0]!)!;
    const middle = measureElementBox(animation({ textAnchor: 'middle' }).elements[0]!)!;
    const end = measureElementBox(animation({ textAnchor: 'end' }).elements[0]!)!;
    expect(middle.x).toBeCloseTo(start.x - start.width / 2, 6);
    expect(end.x).toBeCloseTo(start.x - start.width, 6);
  });
});
