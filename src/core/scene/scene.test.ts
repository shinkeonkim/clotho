import { describe, expect, it } from 'bun:test';
import { animationDocumentSchema } from '../schema/document';
import { buildScene } from './build';
import { countNodes, walkScene, type SceneNode } from './nodes';
import { allMarkerDefs, collectMarkerDefs, markerId, markerUrl } from './markers';
import { applyEffectColor, applyEffectScale, primaryShapeEffect } from './effect-visuals';
import { javascriptHighlighter, plainHighlighter, DEFAULT_CODE_PALETTE } from './highlight';

const ALWAYS = [{ start: 0, end: 1000, entryDuration: 0, exitDuration: 0 }];

function doc(over: Record<string, unknown> = {}) {
  return animationDocumentSchema.parse({
    clothoVersion: 1,
    id: 'demo',
    duration: 1000,
    ...over,
  });
}

function findByKey(nodes: readonly SceneNode[], key: string): SceneNode | undefined {
  for (const node of walkScene(nodes)) if (node.key === key) return node;
  return undefined;
}

const rect = (over: Record<string, unknown> = {}) => ({
  type: 'rect',
  id: 'r',
  x: 0,
  y: 0,
  width: 100,
  height: 50,
  appearances: ALWAYS,
  ...over,
});

describe('buildScene basics', () => {
  it('carries stage metadata from the canvas', () => {
    const scene = buildScene(
      doc({ title: 'T', canvas: { width: 640, height: 480, background: '#fff' } }),
      0,
    );
    expect(scene.viewBox).toBe('0 0 640 480');
    expect(scene.aspectRatio).toBe('640 / 480');
    expect(scene.background).toBe('#fff');
    expect(scene.showMat).toBe(false);
    expect(scene.title).toBe('T');
    expect(scene.time).toBe(0);
  });

  it('exposes the mat for a transparent canvas', () => {
    expect(buildScene(doc(), 0).showMat).toBe(true);
  });

  it('omits invisible elements entirely', () => {
    const scene = buildScene(doc({ elements: [rect({ appearances: [] })] }), 500);
    expect(scene.nodes).toHaveLength(0);
  });

  it('is a pure function of document and time', () => {
    const d = doc({ elements: [rect()] });
    expect(JSON.stringify(buildScene(d, 250))).toBe(JSON.stringify(buildScene(d, 250)));
  });

  it('reports no diagnostics for a clean document', () => {
    expect(buildScene(doc({ elements: [rect()] }), 0).diagnostics).toEqual([]);
  });
});

describe('rect and circle', () => {
  it('wraps a rect with its label in a group', () => {
    const scene = buildScene(doc({ elements: [rect({ label: 'A' })] }), 0);
    const group = scene.nodes[0]!;
    expect(group.kind).toBe('g');
    if (group.kind !== 'g') return;
    expect(group.children.map((c) => c.kind)).toEqual(['rect', 'text']);
    expect(group.children[0]!.attrs).toMatchObject({
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      rx: 8,
      fill: '#a5b4fc',
      'stroke-width': 1.5,
    });
  });

  it('centers the label on the box', () => {
    const scene = buildScene(doc({ elements: [rect({ label: 'A' })] }), 0);
    const label = findByKey(scene.nodes, 'label')!;
    expect(label.attrs).toMatchObject({ x: 50, y: 30, 'text-anchor': 'middle' });
    expect((label as { content?: string }).content).toBe('A');
  });

  it('splits a multi-line subtitle into tspans and keeps blank lines', () => {
    const scene = buildScene(doc({ elements: [rect({ subtitle: 'one\n\ntwo' })] }), 0);
    const subtitle = findByKey(scene.nodes, 'subtitle') as { spans?: { content?: string }[] };
    expect(subtitle.spans).toHaveLength(3);
    expect(subtitle.spans?.[1]?.content).toBe(' ');
  });

  it('emits no transform when there is no rotation or pulse', () => {
    const scene = buildScene(doc({ elements: [rect()] }), 0);
    expect(scene.nodes[0]!.attrs.transform).toBeUndefined();
  });

  it('rotates about the element center', () => {
    const scene = buildScene(doc({ elements: [rect({ rotation: 45 })] }), 0);
    expect(scene.nodes[0]!.attrs.transform).toBe(
      'translate(50 25) rotate(45) scale(1) translate(-50 -25)',
    );
  });

  it('scales about the center while a pulse is active', () => {
    const scene = buildScene(
      doc({
        elements: [rect()],
        effects: [{ type: 'pulse', id: 'p', elementId: 'r', time: 0, duration: 1000, scale: 2 }],
      }),
      500,
    );
    // sin(pi/2) = 1, so the pulse is at full strength halfway through.
    expect(scene.nodes[0]!.attrs.transform).toContain('scale(2)');
  });

  it('replaces the fill while a highlight is active', () => {
    const scene = buildScene(
      doc({
        elements: [rect()],
        effects: [
          { type: 'highlight', id: 'h', elementId: 'r', time: 0, duration: 1000, color: '#ff0000' },
        ],
      }),
      500,
    );
    expect(findByKey(scene.nodes, 'shape')!.attrs.fill).toBe('#ff0000');
  });
});

describe('connectors', () => {
  const connected = (over: Record<string, unknown> = {}) =>
    doc({
      elements: [
        rect({ id: 'a', x: 0, y: 0, width: 100, height: 100 }),
        rect({ id: 'b', x: 300, y: 0, width: 100, height: 100 }),
        {
          type: 'arrow',
          id: 'ar',
          fromId: 'a',
          toId: 'b',
          fromAnchor: 'right',
          toAnchor: 'left',
          appearances: ALWAYS,
          ...over,
        },
      ],
    });

  /** The arrow's own path, found within the arrow group rather than the whole scene. */
  function arrowPath(scene: { nodes: readonly SceneNode[] }): SceneNode {
    const group = scene.nodes.find((n) => n.key === 'ar')!;
    if (group.kind !== 'g') throw new Error('arrow should be a group');
    return group.children.find((c) => c.key === 'shape')!;
  }

  it('draws a straight path between anchors', () => {
    expect(arrowPath(buildScene(connected(), 0)).attrs.d).toBe('M 100 50 L 300 50');
  });

  it('draws a quadratic when curvature is set', () => {
    expect(arrowPath(buildScene(connected({ curvature: 40 }), 0)).attrs.d).toBe(
      'M 100 50 Q 200 90 300 50',
    );
  });

  it('sets CSS color so currentColor markers match the stroke', () => {
    const scene = buildScene(connected({ stroke: '#123456', headEnd: 'arrow' }), 0);
    const group = scene.nodes.find((n) => n.key === 'ar')!;
    expect(group.style?.color).toBe('#123456');
  });

  it('references only the markers it uses', () => {
    const scene = buildScene(connected({ headEnd: 'arrow' }), 0);
    expect(scene.defs.map((d) => d.key)).toEqual(['cloth-h-arrow']);
  });

  it('emits no defs when nothing has a head', () => {
    expect(buildScene(connected(), 0).defs).toEqual([]);
  });

  it('skips an unresolvable connector and says why', () => {
    const scene = buildScene(
      doc({ elements: [{ type: 'arrow', id: 'ar', fromId: 'ghost', appearances: ALWAYS }] }),
      0,
    );
    expect(scene.nodes).toHaveLength(0);
    expect(scene.diagnostics[0]).toMatchObject({
      code: 'unresolved-connector',
      elementId: 'ar',
    });
  });
});

describe('groups', () => {
  const grouped = doc({
    elements: [
      { type: 'group', id: 'g', x: 100, y: 50, appearances: ALWAYS },
      rect({ id: 'kid', parentId: 'g', x: 0, y: 0, width: 10, height: 10 }),
    ],
  });

  it('nests children under the group transform, keyed by the group id', () => {
    const scene = buildScene(grouped, 0);
    const group = scene.nodes[0]!;
    expect(group.key).toBe('g');
    expect(group.attrs.transform).toBe('translate(100 50)');
    expect(group.kind).toBe('g');
    if (group.kind === 'g') expect(group.children.map((c) => c.key)).toEqual(['kid']);
  });

  it('hides the subtree when the group is off stage', () => {
    const hidden = doc({
      elements: [{ type: 'group', id: 'g', appearances: [] }, rect({ id: 'kid', parentId: 'g' })],
    });
    expect(buildScene(hidden, 0).nodes).toHaveLength(0);
  });

  it('drops a group whose children all render nothing', () => {
    const empty = doc({ elements: [{ type: 'group', id: 'g', appearances: ALWAYS }] });
    expect(buildScene(empty, 0).nodes).toEqual([]);
  });

  it('emits no transform for an untransformed group', () => {
    const plain = doc({
      elements: [
        { type: 'group', id: 'g', appearances: ALWAYS },
        rect({ id: 'kid', parentId: 'g' }),
      ],
    });
    expect(buildScene(plain, 0).nodes[0]!.attrs.transform).toBeUndefined();
  });
});

describe('paint order', () => {
  // Legacy sorted the whole flat array so labels were never buried. Doing it per
  // sibling list keeps that outcome for flat documents.
  it('paints text after other elements among siblings', () => {
    const scene = buildScene(
      doc({
        elements: [
          { type: 'text', id: 't', x: 0, y: 0, content: 'label', appearances: ALWAYS },
          rect({ id: 'r' }),
        ],
      }),
      0,
    );
    expect(scene.nodes.map((n) => n.key)).toEqual(['r', 't']);
  });

  it('keeps a grouped text inside its group rather than lifting it to the stage', () => {
    const scene = buildScene(
      doc({
        elements: [
          { type: 'group', id: 'g', appearances: ALWAYS },
          { type: 'text', id: 't', parentId: 'g', x: 0, y: 0, content: 'in', appearances: ALWAYS },
          rect({ id: 'top' }),
        ],
      }),
      0,
    );
    expect(scene.nodes.map((n) => n.key)).toEqual(['g', 'top']);
    expect(findByKey(scene.nodes, 't')).toBeDefined();
  });

  it('preserves document order among non-text siblings', () => {
    const scene = buildScene(
      doc({ elements: [rect({ id: 'first' }), rect({ id: 'second' }), rect({ id: 'third' })] }),
      0,
    );
    expect(scene.nodes.map((n) => n.key)).toEqual(['first', 'second', 'third']);
  });
});

describe('transitions', () => {
  it('wraps a fading element in a group carrying opacity', () => {
    const scene = buildScene(
      doc({
        elements: [
          rect({ appearances: [{ start: 0, end: 1000, entryMode: 'fade', entryDuration: 200 }] }),
        ],
      }),
      100,
    );
    const wrapper = scene.nodes[0]!;
    expect(wrapper.key).toBe('r-phase');
    expect(wrapper.style?.opacity).toBeCloseTo(0.5);
  });

  it('emits a matrix transform for a slide', () => {
    const scene = buildScene(
      doc({
        elements: [
          rect({
            appearances: [{ start: 0, end: 1000, entryMode: 'slide-left', entryDuration: 200 }],
          }),
        ],
      }),
      0,
    );
    expect(scene.nodes[0]!.attrs.transform).toBe('matrix(1 0 0 1 -200 0)');
  });

  it('adds no wrapper once the element is fully visible', () => {
    const scene = buildScene(
      doc({
        elements: [
          rect({ appearances: [{ start: 0, end: 1000, entryMode: 'fade', entryDuration: 200 }] }),
        ],
      }),
      500,
    );
    expect(scene.nodes[0]!.key).toBe('r');
  });
});

describe('images', () => {
  const image = (over: Record<string, unknown> = {}) => ({
    type: 'image',
    id: 'im',
    x: 10,
    y: 20,
    width: 40,
    height: 30,
    assetId: 'logo',
    appearances: ALWAYS,
    ...over,
  });

  it('resolves an inline asset into a data URI href', () => {
    const scene = buildScene(
      doc({
        assets: { logo: { kind: 'inline', mime: 'image/png', data: 'AQID' } },
        elements: [image({ alt: '로고' })],
      }),
      0,
    );
    expect(scene.nodes[0]!.attrs).toMatchObject({
      href: 'data:image/png;base64,AQID',
      'aria-label': '로고',
      role: 'img',
    });
  });

  it('hides an image with no alt text from assistive tech', () => {
    const scene = buildScene(
      doc({ assets: { logo: { kind: 'external', url: '/a.png' } }, elements: [image()] }),
      0,
    );
    expect(scene.nodes[0]!.attrs['aria-hidden']).toBe('true');
  });

  // A placeholder occupying the exact box means nothing moves when the asset lands.
  it('draws a placeholder of the same size for an unresolved asset', () => {
    const scene = buildScene(doc({ elements: [image()] }), 0);
    const node = scene.nodes[0]!;
    expect(node.kind).toBe('rect');
    expect(node.attrs).toMatchObject({ x: 10, y: 20, width: 40, height: 30, fill: 'none' });
    expect(scene.diagnostics[0]?.code).toBe('unresolved-asset');
  });

  it('resolves a ref through the host resolver', () => {
    const scene = buildScene(
      doc({ assets: { logo: { kind: 'ref', key: 'k' } }, elements: [image()] }),
      0,
      { assetResolver: { resolve: (r) => `/cdn/${r.key}` } },
    );
    expect(scene.nodes[0]!.attrs.href).toBe('/cdn/k');
  });

  it('reports a pending async ref and draws a placeholder', () => {
    const scene = buildScene(
      doc({ assets: { logo: { kind: 'ref', key: 'k' } }, elements: [image()] }),
      0,
      { assetResolver: { resolve: async () => '/late' } },
    );
    expect(scene.diagnostics[0]?.code).toBe('pending-asset');
    expect(scene.nodes[0]!.kind).toBe('rect');
  });
});

describe('code', () => {
  const code = (over: Record<string, unknown> = {}) => ({
    type: 'code',
    id: 'c',
    x: 0,
    y: 0,
    width: 300,
    height: 100,
    content: 'const x = 1;',
    appearances: ALWAYS,
    ...over,
  });

  it('tokenizes with the default JavaScript highlighter', () => {
    const scene = buildScene(doc({ elements: [code()] }), 0);
    const text = findByKey(scene.nodes, 'code') as {
      spans?: { spans?: { attrs: Record<string, unknown> }[] }[];
    };
    const colors = text.spans?.[0]?.spans?.map((s) => s.attrs.fill);
    expect(colors).toContain(DEFAULT_CODE_PALETTE.keyword);
    expect(colors).toContain(DEFAULT_CODE_PALETTE.number);
  });

  it('accepts an injected highlighter', () => {
    const scene = buildScene(doc({ elements: [code()] }), 0, { highlighter: plainHighlighter });
    const text = findByKey(scene.nodes, 'code') as {
      spans?: { spans?: { attrs: Record<string, unknown> }[] }[];
    };
    const colors = new Set(text.spans?.[0]?.spans?.map((s) => s.attrs.fill));
    expect(colors).toEqual(new Set(['#e2e8f0']));
  });

  // The legacy bug: gutter width counted UTF-16 units, so CJK line content and
  // wide line numbers mismeasured.
  it('sizes the gutter from East-Asian-aware widths', () => {
    const many = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n');
    const scene = buildScene(
      doc({ elements: [code({ content: many, showLineNumbers: true })] }),
      0,
    );
    const codeText = findByKey(scene.nodes, 'code')!;
    // Two-digit numbers: 2 cells * 12 * 0.6 = 14.4, plus 12 padding and 12 gap.
    expect(codeText.attrs.x).toBeCloseTo(0 + 12 + 14.4 + 12);
  });

  it('omits the gutter when line numbers are off', () => {
    const scene = buildScene(doc({ elements: [code({ showLineNumbers: false })] }), 0);
    expect(findByKey(scene.nodes, 'gutter')).toBeUndefined();
    expect(findByKey(scene.nodes, 'code')!.attrs.x).toBe(12);
  });

  it('preserves whitespace in code spans', () => {
    const scene = buildScene(doc({ elements: [code({ content: '  indented' })] }), 0);
    const text = findByKey(scene.nodes, 'code') as { spans?: { attrs: Record<string, unknown> }[] };
    expect(text.spans?.[0]?.attrs['xml:space']).toBe('preserve');
  });

  it('renders a title bar in upper case', () => {
    const scene = buildScene(doc({ elements: [code({ title: 'example.js' })] }), 0);
    const title = findByKey(scene.nodes, 'text') as { content?: string };
    expect(title.content).toBe('EXAMPLE.JS');
  });
});

describe('flow particles', () => {
  const flowDoc = (over: Record<string, unknown> = {}) =>
    doc({
      elements: [
        { type: 'arrow', id: 'ar', x1: 0, y1: 0, x2: 100, y2: 0, appearances: ALWAYS, ...over },
      ],
      effects: [
        {
          type: 'flow',
          id: 'f',
          elementId: 'ar',
          time: 0,
          duration: 1000,
          particles: 2,
          radius: 5,
        },
      ],
    });

  it('places particles along the chord', () => {
    const scene = buildScene(flowDoc(), 0);
    const particles = scene.nodes.filter((n) => n.key.startsWith('f-'));
    expect(particles).toHaveLength(2);
    expect(particles.map((p) => p.attrs.cx)).toEqual([0, 50]);
    expect(particles[0]!.attrs.r).toBe(5);
  });

  it('advances and wraps with the cycle', () => {
    const scene = buildScene(flowDoc(), 750);
    expect(scene.nodes.filter((n) => n.key.startsWith('f-')).map((p) => p.attrs.cx)).toEqual([
      75, 25,
    ]);
  });

  // Legacy required an arrow specifically; a line has the same two endpoints.
  it('also works on a line', () => {
    const scene = buildScene(
      doc({
        elements: [{ type: 'line', id: 'ln', x1: 0, y1: 0, x2: 100, y2: 0, appearances: ALWAYS }],
        effects: [
          { type: 'flow', id: 'f', elementId: 'ln', time: 0, duration: 1000, particles: 1 },
        ],
      }),
      0,
    );
    expect(scene.nodes.some((n) => n.key === 'f-0')).toBe(true);
  });

  it('draws nothing for a flow on a shape with no path', () => {
    const scene = buildScene(
      doc({
        elements: [rect({ id: 'r' })],
        effects: [{ type: 'flow', id: 'f', elementId: 'r', time: 0, duration: 1000 }],
      }),
      0,
    );
    expect(scene.nodes.some((n) => n.key.startsWith('f-'))).toBe(false);
  });

  it('draws nothing while the connector is hidden', () => {
    const scene = buildScene(flowDoc({ appearances: [] }), 0);
    expect(scene.nodes.some((n) => n.key.startsWith('f-'))).toBe(false);
  });
});

describe('markers', () => {
  it('names directional heads with a start variant', () => {
    expect(markerId('arrow', 'end')).toBe('cloth-h-arrow');
    expect(markerId('arrow', 'start')).toBe('cloth-h-arrow-start');
  });

  it('gives non-directional heads one id for both ends', () => {
    expect(markerId('circle', 'start')).toBe('cloth-h-circle');
    expect(markerId('circle', 'end')).toBe('cloth-h-circle');
  });

  it('returns nothing for none or undefined', () => {
    expect(markerId('none', 'end')).toBeUndefined();
    expect(markerUrl(undefined, 'end')).toBeUndefined();
  });

  it('wraps ids in a url() reference', () => {
    expect(markerUrl('diamond', 'end')).toBe('url(#cloth-h-diamond)');
  });

  it('deduplicates and sorts collected defs', () => {
    const defs = collectMarkerDefs([
      { head: 'arrow', end: 'end' },
      { head: 'arrow', end: 'end' },
      { head: 'bar', end: 'end' },
      { head: 'none', end: 'end' },
      { head: undefined, end: 'start' },
    ]);
    expect(defs.map((d) => d.key)).toEqual(['cloth-h-arrow', 'cloth-h-bar']);
  });

  it('orients a start marker so it points back along the path', () => {
    const [def] = collectMarkerDefs([{ head: 'arrow', end: 'start' }]);
    expect(def!.attrs.orient).toBe('auto-start-reverse');
    expect(def!.attrs.refX).toBe(1);
  });

  it('leaves non-directional markers unoriented', () => {
    const [def] = collectMarkerDefs([{ head: 'circle', end: 'end' }]);
    expect(def!.attrs.orient).toBeUndefined();
  });

  it('can emit every marker for a shared defs block', () => {
    const all = allMarkerDefs();
    expect(all.length).toBeGreaterThan(8);
    expect(new Set(all.map((d) => d.key)).size).toBe(all.length);
  });
});

describe('effect visuals', () => {
  const pulse = {
    type: 'pulse' as const,
    id: 'p',
    elementId: 'r',
    time: 0,
    duration: 1000,
    scale: 2,
  };

  it('picks the first highlight or pulse and ignores flow', () => {
    const flow = {
      type: 'flow' as const,
      id: 'f',
      elementId: 'r',
      time: 0,
      duration: 1,
      particles: 1,
      radius: 1,
      color: '#fff',
    };
    expect(primaryShapeEffect([flow, pulse])?.id).toBe('p');
    expect(primaryShapeEffect([flow])).toBeUndefined();
    expect(primaryShapeEffect(undefined)).toBeUndefined();
  });

  it('peaks a pulse at the midpoint and returns to rest at both ends', () => {
    expect(applyEffectScale(pulse, 0)).toBeCloseTo(1);
    expect(applyEffectScale(pulse, 500)).toBeCloseTo(2);
    expect(applyEffectScale(pulse, 1000)).toBeCloseTo(1);
  });

  it('leaves scale alone without a pulse', () => {
    expect(applyEffectScale(undefined, 0)).toBe(1);
  });

  it('guards a zero-duration pulse against dividing by zero', () => {
    expect(applyEffectScale({ ...pulse, duration: 0 }, 0)).toBe(1);
  });

  it('uses the highlight color, else the state color, else the default', () => {
    const highlight = {
      type: 'highlight' as const,
      id: 'h',
      elementId: 'r',
      time: 0,
      duration: 1,
      color: '#f00',
    };
    expect(applyEffectColor('#0f0', highlight, '#00f')).toBe('#f00');
    expect(applyEffectColor('#0f0', undefined, '#00f')).toBe('#0f0');
    expect(applyEffectColor(undefined, undefined, '#00f')).toBe('#00f');
  });
});

describe('highlighters', () => {
  const palette = { ...DEFAULT_CODE_PALETTE, text: '#fff' };

  it('colors keywords, numbers, strings, builtins, and comments', () => {
    const tokens = javascriptHighlighter.highlightLine(
      'const x = Math.max(1, "a"); // note',
      palette,
      'javascript',
    );
    const byColor = (color: string) => tokens.filter((t) => t.color === color).map((t) => t.text);
    expect(byColor(palette.keyword)).toContain('const');
    expect(byColor(palette.builtin)).toContain('Math');
    expect(byColor(palette.number)).toContain('1');
    expect(byColor(palette.string)).toContain('"a"');
    expect(byColor(palette.comment)).toContain('// note');
  });

  it('does not recolor keywords inside a string', () => {
    const tokens = javascriptHighlighter.highlightLine('"const"', palette, 'javascript');
    expect(tokens).toEqual([{ text: '"const"', color: palette.string }]);
  });

  it('preserves the full line, character for character', () => {
    const line = '  if (a) { return 1; } // 한글';
    const tokens = javascriptHighlighter.highlightLine(line, palette, 'javascript');
    expect(tokens.map((t) => t.text).join('')).toBe(line);
  });

  it('returns nothing for an empty line', () => {
    expect(javascriptHighlighter.highlightLine('', palette, 'javascript')).toEqual([]);
    expect(plainHighlighter.highlightLine('', palette, 'javascript')).toEqual([]);
  });
});

describe('scene helpers', () => {
  it('counts nodes across the tree', () => {
    const scene = buildScene(doc({ elements: [rect({ label: 'A' })] }), 0);
    expect(countNodes(scene.nodes)).toBe(3); // g + rect + text
  });
});
