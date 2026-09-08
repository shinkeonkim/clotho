// Chart compiler tests.
//
// The id convention is the contract, so it is asserted literally: a cosmetic change
// to how a bar is drawn is fine, an id that moves breaks somebody's `pulse`.

import { describe, expect, it } from 'bun:test';
import { animationDocumentSchema } from '../schema/document';
import type { AnimationDocument } from '../schema/document';
import { validateDocument } from '../validate/validate';
import { buildScene } from '../scene/build';
import { compileCharts } from './compile';
import { chartIds, slugify } from './ids';

function animation(
  chart: Record<string, unknown>,
  over: Record<string, unknown> = {},
): AnimationDocument {
  return animationDocumentSchema.parse({
    clothoVersion: 1,
    id: 'doc',
    duration: 6000,
    canvas: { width: 720, height: 400 },
    charts: [
      {
        id: 'bench',
        x: 40,
        y: 30,
        width: 640,
        height: 320,
        kind: 'bar',
        data: [
          { name: 'naive', ms: 120 },
          { name: 'memo', ms: 45 },
          { name: 'closed', ms: 4 },
        ],
        encode: { x: 'name', y: 'ms' },
        ...chart,
      },
    ],
    ...over,
  });
}

const idsOf = (doc: AnimationDocument): string[] => doc.elements.map((el) => el.id);
const byId = (doc: AnimationDocument, id: string) => doc.elements.find((el) => el.id === id);

describe('slugify', () => {
  it('makes a series name safe for an id', () => {
    expect(slugify('Quick Sort')).toBe('quick-sort');
    expect(slugify('p95 (ms)')).toBe('p95-ms');
  });

  it('never forges a path separator', () => {
    expect(slugify('a__b')).toBe('a_b');
  });

  it('gives an empty name something to be', () => {
    expect(slugify('   ')).toBe('x');
    expect(slugify('!!!')).toBe('x');
  });
});

describe('compileCharts', () => {
  it('leaves a document without charts untouched', () => {
    const plain = animationDocumentSchema.parse({ clothoVersion: 1, id: 'a', duration: 100 });
    const result = compileCharts(plain);
    expect(result.document).toBe(plain);
    expect(result.findings).toEqual([]);
  });

  it('produces the documented ids', () => {
    const { document: compiled } = compileCharts(animation({ axes: { y: { grid: true } } }));
    const ids = idsOf(compiled);
    expect(ids).toContain('bench__axis-x');
    expect(ids).toContain('bench__axis-y');
    expect(ids).toContain('bench__axis-y__tick-0__label');
    expect(ids).toContain('bench__grid-y__line-0');
    expect(ids).toContain('bench__series-value__point-0');
    expect(ids).toContain('bench__plot');
    expect(chartIds.point('bench', 'Quick Sort', 3)).toBe('bench__series-quick-sort__point-3');
  });

  it('emits a document that parses and validates', () => {
    const { document: compiled } = compileCharts(
      animation({ legend: true, axes: { x: { label: 'impl' } } }),
    );
    expect(() => animationDocumentSchema.parse(compiled)).not.toThrow();
    const report = validateDocument(compiled);
    expect(report.findings.filter((f) => f.severity === 'error')).toEqual([]);
  });

  it('draws one bar per row, ordered as authored', () => {
    const { document: compiled } = compileCharts(animation({}));
    const bars = compiled.elements.filter((el) => el.id.includes('__point-'));
    expect(bars).toHaveLength(3);
    expect(bars.map((bar) => bar.id)).toEqual([
      'bench__series-value__point-0',
      'bench__series-value__point-1',
      'bench__series-value__point-2',
    ]);
    // Taller value, taller bar.
    const heights = bars.map((bar) => (bar as { height: number }).height);
    expect(heights[0]).toBeGreaterThan(heights[1]!);
    expect(heights[1]).toBeGreaterThan(heights[2]!);
  });

  it('starts a bar value axis at zero, so bar lengths do not lie', () => {
    const { document: compiled } = compileCharts(
      animation({
        data: [
          { name: 'a', ms: 100 },
          { name: 'b', ms: 105 },
        ],
      }),
    );
    const bars = compiled.elements.filter((el) => el.id.includes('__point-'));
    const heights = bars.map((bar) => (bar as { height: number }).height);
    // With a zero baseline the two bars are within 10% of each other; a truncated
    // axis would make 105 look several times 100.
    expect(heights[1]! / heights[0]!).toBeGreaterThan(0.9);
  });

  it('replaces its own previous output rather than appending to it', () => {
    const once = compileCharts(animation({})).document;
    const twice = compileCharts(once).document;
    expect(idsOf(twice)).toEqual(idsOf(once));
    expect(twice.elements).toEqual(once.elements);
  });

  it('keeps authored elements alongside the generated ones', () => {
    const withAuthored = animation(
      {},
      {
        elements: [
          {
            type: 'text',
            id: 'caption',
            x: 10,
            y: 380,
            content: 'lower is better',
            appearances: [{ start: 0, end: 6000 }],
          },
        ],
      },
    );
    const { document: compiled } = compileCharts(withAuthored);
    expect(idsOf(compiled)).toContain('caption');
    expect(idsOf(compiled)).toContain('bench__axis-x');
  });

  it('separates series and colors them apart', () => {
    const { document: compiled } = compileCharts(
      animation({
        encode: { x: 'name', y: 'ms', series: 'impl' },
        data: [
          { name: 'n=10', ms: 5, impl: 'quick' },
          { name: 'n=10', ms: 9, impl: 'bubble' },
          { name: 'n=20', ms: 11, impl: 'quick' },
          { name: 'n=20', ms: 40, impl: 'bubble' },
        ],
      }),
    );
    const ids = idsOf(compiled);
    expect(ids).toContain('bench__series-quick__point-0');
    expect(ids).toContain('bench__series-bubble__point-1');
    const quick = byId(compiled, 'bench__series-quick__point-0') as { fill: string };
    const bubble = byId(compiled, 'bench__series-bubble__point-1') as { fill: string };
    expect(quick.fill).not.toBe(bubble.fill);
  });

  it('reports rows it cannot use instead of dropping them silently', () => {
    const { document: compiled, findings } = compileCharts(
      animation({
        data: [
          { name: 'a', ms: 10 },
          { name: 'b', ms: 'oops' },
        ],
      }),
    );
    expect(findings.map((f) => f.code)).toContain('non-numeric');
    expect(compiled.elements.filter((el) => el.id.includes('__point-'))).toHaveLength(1);
  });

  it('reports a chart with nothing to draw', () => {
    const { findings } = compileCharts(animation({ data: [] }));
    expect(findings.map((f) => f.code)).toContain('empty-data');
  });

  it('thins crowded tick labels and says so', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ name: `category-${i}`, ms: i }));
    const { document: compiled, findings } = compileCharts(animation({ data: many }));
    expect(findings.map((f) => f.code)).toContain('label-crowding');
    const labels = compiled.elements.filter((el) => el.id.includes('axis-x__tick-'));
    expect(labels.length).toBeLessThan(40);
    expect(labels.length).toBeGreaterThan(0);
  });
});

describe('reveal modes', () => {
  const tracksOf = (doc: AnimationDocument, id: string) =>
    (byId(doc, id) as { tracks: { property: string }[] } | undefined)?.tracks ?? [];

  it('adds nothing for mode none', () => {
    const { document: compiled } = compileCharts(animation({ reveal: { mode: 'none' } }));
    expect(tracksOf(compiled, 'bench__series-value__point-0')).toEqual([]);
  });

  it('grow animates height and y together, so the bar rises from the baseline', () => {
    const { document: compiled } = compileCharts(
      animation({ reveal: { mode: 'grow', start: 500, duration: 1000, stagger: 100 } }),
    );
    const properties = tracksOf(compiled, 'bench__series-value__point-1').map((t) => t.property);
    expect(properties.sort()).toEqual(['height', 'y']);

    const bar = byId(compiled, 'bench__series-value__point-1') as {
      tracks: { property: string; keyframes: { time: number; value: number }[] }[];
    };
    const height = bar.tracks.find((t) => t.property === 'height')!;
    expect(height.keyframes[0]!.value).toBe(0);
    // Stagger delays the second bar by one step.
    expect(height.keyframes[0]!.time).toBe(600);
    expect(height.keyframes[1]!.time).toBe(1600);
    expect(height.keyframes[1]!.value).toBeGreaterThan(0);
  });

  it('sweep dashes a line and animates the offset to zero', () => {
    const { document: compiled } = compileCharts(
      animation({ kind: 'line', reveal: { mode: 'sweep', start: 0, duration: 900 } }),
    );
    const series = byId(compiled, 'bench__series-value') as {
      strokeDasharray?: string;
      tracks: { property: string; keyframes: { value: number }[] }[];
    };
    expect(series.strokeDasharray).toBeDefined();
    const offset = series.tracks.find((t) => t.property === 'strokeDashoffset')!;
    expect(offset.keyframes.at(-1)!.value).toBe(0);
    expect(offset.keyframes[0]!.value).toBeGreaterThan(0);
  });

  it('series staggers appearance windows instead of animating geometry', () => {
    const { document: compiled } = compileCharts(
      animation({
        encode: { x: 'name', y: 'ms', series: 'impl' },
        data: [
          { name: 'a', ms: 1, impl: 'first' },
          { name: 'a', ms: 2, impl: 'second' },
        ],
        reveal: { mode: 'series', start: 400, duration: 500, stagger: 300 },
      }),
    );
    const first = byId(compiled, 'bench__series-first__point-0') as {
      appearances: { start: number }[];
    };
    const second = byId(compiled, 'bench__series-second__point-1') as {
      appearances: { start: number }[];
    };
    expect(first.appearances[0]!.start).toBe(400);
    expect(second.appearances[0]!.start).toBe(700);
  });
});

describe('the plot rectangle', () => {
  it('draws nothing but makes the data region addressable', () => {
    const { document: compiled } = compileCharts(animation({}));
    const plot = byId(compiled, 'bench__plot') as { fill: string; stroke: string; width: number };
    expect(plot.fill).toBe('none');
    expect(plot.stroke).toBe('none');
    expect(plot.width).toBeGreaterThan(0);
  });

  it('can be framed by a camera, which is the reason it exists', () => {
    const compiledDoc = compileCharts(animation({})).document;
    const wired = animationDocumentSchema.parse({
      ...compiledDoc,
      camera: { focus: [{ time: 0, duration: 0, elementIds: ['bench__plot'], padding: 0 }] },
    });
    const scene = buildScene(wired, 100);
    expect(scene.diagnostics).toEqual([]);
    expect(scene.camera!.zoom).toBeGreaterThan(1);
  });
});

describe('a compiled chart works with everything else', () => {
  it('accepts a pulse on one bar, a spotlight on a series and a camera focus on an axis', () => {
    const base = compileCharts(
      animation({
        encode: { x: 'name', y: 'ms', series: 'impl' },
        data: [
          { name: 'a', ms: 10, impl: 'quick' },
          { name: 'b', ms: 30, impl: 'quick' },
        ],
      }),
    ).document;

    const wired = animationDocumentSchema.parse({
      ...base,
      effects: [
        { type: 'pulse', id: 'p', elementId: 'bench__series-quick__point-1', time: 1000 },
        {
          type: 'spotlight',
          id: 's',
          elementIds: ['bench__series-quick__point-0'],
          time: 1000,
          duration: 500,
          fadeIn: 0,
        },
      ],
      camera: {
        focus: [{ time: 1000, duration: 0, elementIds: ['bench__axis-y'], padding: 10 }],
      },
    });

    const scene = buildScene(wired, 1200);
    // No diagnostics means every id resolved to a real element.
    expect(scene.diagnostics).toEqual([]);
    expect(scene.camera).not.toBeNull();
    expect(scene.defs.some((def) => def.kind === 'mask')).toBe(true);
  });
});

/**
 * `sweep` writes a `strokeDashoffset` track, and that only draws anything if the
 * path element carries the property and the renderer emits it. Before this was
 * wired the track compiled fine, validated fine, and animated nothing — the exact
 * silent no-op the schema-property validator exists to prevent.
 */
describe('sweep actually reaches the renderer', () => {
  it('emits a moving stroke-dashoffset attribute', () => {
    const { document: compiled } = compileCharts(
      animation({ kind: 'line', reveal: { mode: 'sweep', start: 0, duration: 1000 } }),
    );
    const parsed = animationDocumentSchema.parse(compiled);
    const at = (time: number) => {
      const node = buildScene(parsed, time).nodes.find((n) => n.key === 'bench__series-value')!;
      const shape = node.kind === 'g' ? (node.children[0] ?? node) : node;
      return shape.attrs['stroke-dashoffset'];
    };
    expect(at(0)).toBeGreaterThan(0);
    expect(at(1000)).toBe(0);
    // Blended, not stepped: halfway through the offset is halfway down.
    expect(at(500)).toBeLessThan(at(0) as number);
    expect(at(500)).toBeGreaterThan(0);
  });
});
