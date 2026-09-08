// Document diff tests.
//
// The output is for a person, so the assertions are about what a reviewer would be
// told: one line per thing that happened, in the author's vocabulary, with the
// noise folded away.

import { describe, expect, it } from 'bun:test';
import { animationDocumentSchema } from '../schema/document';
import type { AnimationDocument } from '../schema/document';
import { diffDocuments, significantChanges, similarity } from './index';

const ALWAYS = [{ start: 0, end: 1000, entryDuration: 0, exitDuration: 0 }];

function animation(over: Record<string, unknown> = {}): AnimationDocument {
  const { elements, ...rest } = over as { elements?: Record<string, unknown>[] };
  return animationDocumentSchema.parse({
    clothoVersion: 1,
    id: 'doc',
    title: 'Doc',
    duration: 1000,
    canvas: { width: 400, height: 300 },
    elements: (
      elements ?? [
        { type: 'rect', id: 'box', x: 10, y: 10, width: 50, height: 30, fill: '#a5b4fc' },
        { type: 'circle', id: 'dot', cx: 200, cy: 100, r: 20 },
      ]
    ).map((element) => ({ appearances: ALWAYS, ...element })),
    ...rest,
  });
}

const find = (result: ReturnType<typeof diffDocuments>, subject: string) =>
  result.changes.find((change) => change.subject === subject);

describe('diffDocuments', () => {
  it('reports nothing for a document compared with itself', () => {
    const result = diffDocuments(animation(), animation());
    expect(result.changes).toEqual([]);
    expect(result.renames).toEqual([]);
  });

  it('names an added and a removed element by what it is', () => {
    const before = animation();
    const after = animation({
      elements: [
        { type: 'rect', id: 'box', x: 10, y: 10, width: 50, height: 30, fill: '#a5b4fc' },
        { type: 'text', id: 'caption', x: 5, y: 290, content: 'hello' },
      ],
    });
    const result = diffDocuments(before, after, { detectRenames: false });
    expect(find(result, 'dot')).toMatchObject({ kind: 'removed', detail: 'circle' });
    expect(find(result, 'caption')).toMatchObject({ kind: 'added', detail: 'text' });
  });

  it('reports a move as a move, with both positions', () => {
    const after = animation({
      elements: [
        { type: 'rect', id: 'box', x: 120, y: 10, width: 50, height: 30, fill: '#a5b4fc' },
        { type: 'circle', id: 'dot', cx: 200, cy: 100, r: 20 },
      ],
    });
    const change = find(diffDocuments(animation(), after), 'box')!;
    expect(change.kind).toBe('moved');
    expect(change.detail).toBe('(10, 10) → (120, 10)');
    expect(change.minor).toBe(false);
  });

  it('folds a sub-threshold nudge into the minor pile', () => {
    const after = animation({
      elements: [
        { type: 'rect', id: 'box', x: 11, y: 10, width: 50, height: 30, fill: '#a5b4fc' },
        { type: 'circle', id: 'dot', cx: 200, cy: 100, r: 20 },
      ],
    });
    const result = diffDocuments(animation(), after);
    expect(find(result, 'box')!.minor).toBe(true);
    expect(significantChanges(result)).toEqual([]);
  });

  it('ignores float noise that rounds to the same value', () => {
    const after = animation({
      elements: [
        {
          type: 'rect',
          id: 'box',
          x: 10.0000000001,
          y: 10,
          width: 50,
          height: 30,
          fill: '#a5b4fc',
        },
        { type: 'circle', id: 'dot', cx: 200, cy: 100, r: 20 },
      ],
    });
    expect(diffDocuments(animation(), after).changes).toEqual([]);
  });

  it('names a changed property rather than dumping the element', () => {
    const after = animation({
      elements: [
        { type: 'rect', id: 'box', x: 10, y: 10, width: 50, height: 30, fill: '#ff0000' },
        { type: 'circle', id: 'dot', cx: 200, cy: 100, r: 20 },
      ],
    });
    expect(find(diffDocuments(animation(), after), 'box.fill')).toMatchObject({
      kind: 'changed',
      detail: '#a5b4fc → #ff0000',
    });
  });

  it('reports a reparent', () => {
    const before = animation({
      elements: [
        { type: 'group', id: 'g', x: 0, y: 0 },
        { type: 'rect', id: 'box', x: 0, y: 0, width: 10, height: 10 },
      ],
    });
    const after = animation({
      elements: [
        { type: 'group', id: 'g', x: 0, y: 0 },
        { type: 'rect', id: 'box', parentId: 'g', x: 0, y: 0, width: 10, height: 10 },
      ],
    });
    expect(find(diffDocuments(before, after), 'box')).toMatchObject({
      kind: 'reparented',
      detail: '(root) → g',
    });
  });
});

describe('tracks and appearances', () => {
  const tracked = (keyframes: { time: number; value: number }[]) =>
    animation({
      elements: [
        {
          type: 'rect',
          id: 'box',
          x: 10,
          y: 10,
          width: 50,
          height: 30,
          tracks: [{ property: 'x', keyframes }],
        },
      ],
    });

  it('counts keyframes rather than diffing the array', () => {
    const before = tracked([
      { time: 0, value: 0 },
      { time: 1000, value: 100 },
    ]);
    const after = tracked([
      { time: 0, value: 0 },
      { time: 500, value: 50 },
      { time: 1000, value: 100 },
    ]);
    expect(find(diffDocuments(before, after), 'box.x')).toMatchObject({
      kind: 'changed',
      detail: '2 → 3 keyframes',
    });
  });

  it('reports changed values at the same count', () => {
    const before = tracked([
      { time: 0, value: 0 },
      { time: 1000, value: 100 },
    ]);
    const after = tracked([
      { time: 0, value: 0 },
      { time: 1000, value: 250 },
    ]);
    expect(find(diffDocuments(before, after), 'box.x')!.detail).toBe('keyframe values changed');
  });

  it('reports an added and a removed track', () => {
    const plain = animation({
      elements: [{ type: 'rect', id: 'box', x: 10, y: 10, width: 50, height: 30 }],
    });
    const withTrack = tracked([
      { time: 0, value: 0 },
      { time: 1000, value: 100 },
    ]);
    expect(find(diffDocuments(plain, withTrack), 'box.x')!.kind).toBe('added');
    expect(find(diffDocuments(withTrack, plain), 'box.x')!.kind).toBe('removed');
  });

  it('reports a changed appearance window in times, not in objects', () => {
    const before = animation({
      elements: [{ type: 'rect', id: 'box', x: 0, y: 0, width: 1, height: 1 }],
    });
    const after = animation({
      elements: [
        {
          type: 'rect',
          id: 'box',
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          appearances: [{ start: 200, end: 800 }],
        },
      ],
    });
    expect(find(diffDocuments(before, after), 'box')!.detail).toBe('0–1000 → 200–800');
  });
});

describe('rename detection', () => {
  const renamedDoc = (id: string) =>
    animation({
      elements: [
        { type: 'rect', id, x: 10, y: 10, width: 50, height: 30, fill: '#a5b4fc' },
        { type: 'circle', id: 'dot', cx: 200, cy: 100, r: 20 },
      ],
    });

  it('recognizes a rename instead of reporting a removal and an addition', () => {
    const result = diffDocuments(renamedDoc('box'), renamedDoc('panel'));
    expect(result.renames).toHaveLength(1);
    expect(result.renames[0]).toMatchObject({ from: 'box', to: 'panel' });
    expect(find(result, 'box')).toMatchObject({ kind: 'renamed', detail: '→ panel' });
    expect(result.changes.some((change) => change.kind === 'added')).toBe(false);
  });

  it('marks the guess as inferred, because it is one', () => {
    const result = diffDocuments(renamedDoc('box'), renamedDoc('panel'));
    expect(find(result, 'box')!.inferred).toBe(true);
  });

  it('falls back to removed plus added when told not to guess', () => {
    const result = diffDocuments(renamedDoc('box'), renamedDoc('panel'), {
      detectRenames: false,
    });
    expect(result.renames).toEqual([]);
    expect(find(result, 'box')!.kind).toBe('removed');
    expect(find(result, 'panel')!.kind).toBe('added');
  });

  it('does not pair elements of different types', () => {
    const before = animation({
      elements: [{ type: 'rect', id: 'a', x: 0, y: 0, width: 10, height: 10 }],
    });
    const after = animation({ elements: [{ type: 'circle', id: 'b', cx: 0, cy: 0, r: 5 }] });
    expect(diffDocuments(before, after).renames).toEqual([]);
  });

  it('does not pair elements that are nowhere near each other', () => {
    const before = animation({
      elements: [{ type: 'rect', id: 'a', x: 0, y: 0, width: 10, height: 10 }],
    });
    const after = animation({
      elements: [{ type: 'rect', id: 'b', x: 900, y: 900, width: 400, height: 400 }],
    });
    expect(diffDocuments(before, after).renames).toEqual([]);
  });

  it('pairs a whole renamed run one-to-one', () => {
    const run = (prefix: string) =>
      animation({
        elements: Array.from({ length: 4 }, (_, i) => ({
          type: 'rect',
          id: `${prefix}-${i}`,
          x: i * 60,
          y: 0,
          width: 50,
          height: 30,
        })),
      });
    const result = diffDocuments(run('cell'), run('slot'));
    expect(result.renames).toHaveLength(4);
    for (const rename of result.renames) {
      expect(rename.to).toBe(rename.from.replace('cell', 'slot'));
    }
  });

  it('still reports what changed inside a renamed element', () => {
    const before = animation({
      elements: [{ type: 'rect', id: 'box', x: 10, y: 10, width: 50, height: 30, fill: '#111111' }],
    });
    const after = animation({
      elements: [
        { type: 'rect', id: 'panel', x: 10, y: 10, width: 50, height: 30, fill: '#222222' },
      ],
    });
    const result = diffDocuments(before, after);
    expect(find(result, 'box→panel.fill')).toMatchObject({ detail: '#111111 → #222222' });
  });
});

describe('similarity', () => {
  const rect = (over: Record<string, unknown>) =>
    animation({
      elements: [{ type: 'rect', id: 'x', x: 0, y: 0, width: 10, height: 10, ...over }],
    }).elements[0]!;

  it('is 1 for identical geometry', () => {
    expect(similarity(rect({}), rect({}))).toBeCloseTo(1, 6);
  });

  it('is 0 across types', () => {
    const circle = animation({ elements: [{ type: 'circle', id: 'c', cx: 0, cy: 0, r: 5 }] })
      .elements[0]!;
    expect(similarity(rect({}), circle)).toBe(0);
  });

  it('falls off with distance', () => {
    expect(similarity(rect({}), rect({ x: 50 }))).toBeLessThan(1);
    expect(similarity(rect({}), rect({ x: 50 }))).toBeGreaterThan(
      similarity(rect({}), rect({ x: 300 })),
    );
  });
});

describe('the rest of the document', () => {
  it('reports duration, canvas and title separately', () => {
    const after = animation({
      title: 'Renamed',
      duration: 2000,
      canvas: { width: 800, height: 300 },
    });
    const result = diffDocuments(animation(), after);
    expect(find(result, 'title')).toBeDefined();
    expect(find(result, 'duration')!.detail).toBe('1000 → 2000');
    expect(find(result, 'canvas')).toBeDefined();
  });

  it('reports chapters by time and label', () => {
    const before = animation({ chapters: [{ id: 'c1', time: 100, label: 'One' }] });
    const after = animation({ chapters: [{ id: 'c1', time: 400, label: 'One' }] });
    expect(find(diffDocuments(before, after), 'c1')!.detail).toBe('100ms One → 400ms One');
  });

  it('reports effects by what they do and to what', () => {
    const after = animation({
      effects: [{ type: 'pulse', id: 'p', elementId: 'dot', time: 500 }],
    });
    expect(find(diffDocuments(animation(), after), 'p')).toMatchObject({
      kind: 'added',
      detail: 'pulse on dot at 500ms',
    });
  });

  it('reports a spotlight by all of its targets', () => {
    const after = animation({
      effects: [{ type: 'spotlight', id: 's', elementIds: ['box', 'dot'], time: 0, duration: 100 }],
    });
    expect(find(diffDocuments(animation(), after), 's')!.detail).toContain('box, dot');
  });

  it('reports assets by kind', () => {
    const after = animation({
      assets: { logo: { kind: 'inline', mime: 'image/png', data: 'AQID' } },
    });
    expect(find(diffDocuments(animation(), after), 'logo')).toMatchObject({
      scope: 'asset',
      kind: 'added',
    });
  });

  it('treats a camera and a style as their own scopes', () => {
    const after = animation({
      camera: { tracks: [{ property: 'zoom', keyframes: [{ time: 0, value: 2 }] }] },
      style: { preset: 'sketch' },
    });
    const result = diffDocuments(animation(), after);
    expect(find(result, 'camera')!.scope).toBe('camera');
    expect(find(result, 'style')!.scope).toBe('style');
  });

  it('calls an updatedAt bump minor, since it is bookkeeping', () => {
    const after = animation({ updatedAt: '2026-01-01T00:00:00Z' });
    expect(find(diffDocuments(animation(), after), 'updatedAt')!.minor).toBe(true);
  });
});
