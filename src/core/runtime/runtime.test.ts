// Runtime tests. Every case from the legacy engine's schema/runtime.test.ts
// (395 lines, the only reference implementation that had them) is carried over,
// then extended for v1's explicit `interpolate` modes.
//
// These pin down behavior that 383 existing documents depend on, so they are
// written against observable output rather than internals.

import { describe, expect, it } from 'bun:test';
import type { AnimationDocument } from '../schema/document';
import type { AnimationElement } from '../schema/elements';
import { animationDocumentSchema } from '../schema/document';
import { elementSchema } from '../schema/elements';
import { activeAppearance, computeSnapshot, trackValueAt } from './snapshot';
import { currentChapter, sortedChapters } from './chapters';
import { activeEffects, activeEffectsByElement } from './effects';
import { parseColor, rgbaToHex, lerpColor } from './color';
import { blendValues, classifyProperty, resolveBlendMode } from './interpolation';
import { easeApply } from '../timing/ease';

function makeDoc(overrides: Record<string, unknown> = {}): AnimationDocument {
  return animationDocumentSchema.parse({ clothoVersion: 1, id: 'a', ...overrides });
}

function rectEl(overrides: Record<string, unknown> = {}): AnimationElement {
  return elementSchema.parse({
    type: 'rect',
    id: 'r1',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    ...overrides,
  });
}

// ---------------------------------------------------------------- appearances

describe('activeAppearance', () => {
  const el = rectEl({
    appearances: [
      {
        start: 100,
        end: 1000,
        entryMode: 'fade',
        entryDuration: 100,
        exitMode: 'fade',
        exitDuration: 100,
      },
    ],
  });

  it('returns null when time is before the window', () => {
    expect(activeAppearance(el, 50)).toBeNull();
  });

  it('detects entry phase and computes progress', () => {
    const r = activeAppearance(el, 150);
    expect(r?.phase).toBe('entry');
    expect(r?.phaseProgress).toBeCloseTo(0.5);
  });

  it('detects visible phase between entry and exit', () => {
    const r = activeAppearance(el, 500);
    expect(r?.phase).toBe('visible');
    expect(r?.phaseProgress).toBe(1);
  });

  it('detects exit phase near the end', () => {
    const r = activeAppearance(el, 950);
    expect(r?.phase).toBe('exit');
    expect(r?.phaseProgress).toBeCloseTo(0.5);
  });

  it('returns null when time is after the window', () => {
    expect(activeAppearance(el, 2000)).toBeNull();
  });

  it('returns null for elements with no appearances', () => {
    expect(activeAppearance(rectEl(), 0)).toBeNull();
  });

  it('skips entry/exit durations when mode is instant', () => {
    const instant = rectEl({
      appearances: [
        {
          start: 0,
          end: 500,
          entryMode: 'instant',
          entryDuration: 300,
          exitMode: 'instant',
          exitDuration: 300,
        },
      ],
    });
    expect(activeAppearance(instant, 250)?.phase).toBe('visible');
  });

  it('skips durations when mode is absent, not just when it is instant', () => {
    const noMode = rectEl({
      appearances: [{ start: 0, end: 500, entryDuration: 300, exitDuration: 300 }],
    });
    expect(activeAppearance(noMode, 10)?.phase).toBe('visible');
    expect(activeAppearance(noMode, 490)?.phase).toBe('visible');
  });

  it('picks the window containing the time when several exist', () => {
    const multi = rectEl({
      appearances: [
        { start: 0, end: 100, entryDuration: 0, exitDuration: 0 },
        { start: 500, end: 600, entryDuration: 0, exitDuration: 0 },
      ],
    });
    expect(activeAppearance(multi, 50)?.appearance.end).toBe(100);
    expect(activeAppearance(multi, 550)?.appearance.start).toBe(500);
    expect(activeAppearance(multi, 300)).toBeNull();
  });

  it('is inclusive at both window boundaries', () => {
    const window = rectEl({
      appearances: [{ start: 100, end: 200, entryDuration: 0, exitDuration: 0 }],
    });
    expect(activeAppearance(window, 100)).not.toBeNull();
    expect(activeAppearance(window, 200)).not.toBeNull();
    expect(activeAppearance(window, 99)).toBeNull();
    expect(activeAppearance(window, 201)).toBeNull();
  });
});

// ------------------------------------------------------------------ snapshot

describe('computeSnapshot', () => {
  it('marks elements invisible when appearances are empty', () => {
    const snap = computeSnapshot(makeDoc({ elements: [rectEl()] }), 100);
    expect(snap.get('r1')?.visible).toBe(false);
  });

  it('marks visible when an appearance covers the time', () => {
    const doc = makeDoc({
      elements: [
        rectEl({ appearances: [{ start: 0, end: 1000, entryDuration: 0, exitDuration: 0 }] }),
      ],
    });
    expect(computeSnapshot(doc, 500).get('r1')?.visible).toBe(true);
  });

  it('interpolates numeric tracks', () => {
    const doc = makeDoc({
      elements: [
        rectEl({
          appearances: [{ start: 0, end: 1000, entryDuration: 0, exitDuration: 0 }],
          tracks: [
            {
              property: 'x',
              keyframes: [
                { time: 0, value: 0, ease: 'linear' },
                { time: 1000, value: 100, ease: 'linear' },
              ],
            },
          ],
        }),
      ],
    });
    expect(computeSnapshot(doc, 500).get('r1')?.x).toBeCloseTo(50, 1);
  });

  it('clamps track values before the first and after the last keyframe', () => {
    const doc = makeDoc({
      elements: [
        rectEl({
          tracks: [
            {
              property: 'x',
              keyframes: [
                { time: 100, value: 5 },
                { time: 500, value: 50 },
              ],
            },
          ],
        }),
      ],
    });
    expect(computeSnapshot(doc, 0).get('r1')?.x).toBe(5);
    expect(computeSnapshot(doc, 9999).get('r1')?.x).toBe(50);
  });

  it('interpolates color tracks on color properties', () => {
    const doc = makeDoc({
      elements: [
        rectEl({
          tracks: [
            {
              property: 'fill',
              keyframes: [
                { time: 0, value: '#000000', ease: 'linear' },
                { time: 1000, value: '#ffffff', ease: 'linear' },
              ],
            },
          ],
        }),
      ],
    });
    expect(computeSnapshot(doc, 500).get('r1')?.fill).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('falls back to the nearest value when a color fails to parse', () => {
    const doc = makeDoc({
      elements: [
        rectEl({
          tracks: [
            {
              property: 'fill',
              keyframes: [
                { time: 0, value: 'bad-color-1' },
                { time: 1000, value: 'bad-color-2' },
              ],
            },
          ],
        }),
      ],
    });
    expect(computeSnapshot(doc, 250).get('r1')?.fill).toBe('bad-color-1');
    expect(computeSnapshot(doc, 750).get('r1')?.fill).toBe('bad-color-2');
  });

  it('leaves CSS variables intact rather than mangling them', () => {
    const doc = makeDoc({
      elements: [
        rectEl({
          tracks: [
            {
              property: 'fill',
              keyframes: [
                { time: 0, value: 'var(--brand)' },
                { time: 1000, value: 'var(--accent)' },
              ],
            },
          ],
        }),
      ],
    });
    expect(computeSnapshot(doc, 100).get('r1')?.fill).toBe('var(--brand)');
    expect(computeSnapshot(doc, 900).get('r1')?.fill).toBe('var(--accent)');
  });

  it('records entry/exit mode and progress in visual state', () => {
    const doc = makeDoc({
      elements: [
        rectEl({
          appearances: [
            {
              start: 0,
              end: 1000,
              entryMode: 'fade',
              entryDuration: 100,
              exitMode: 'fade',
              exitDuration: 100,
            },
          ],
        }),
      ],
    });
    const entry = computeSnapshot(doc, 50).get('r1');
    expect(entry?.__entryMode).toBe('fade');
    expect(entry?.__entryProgress).toBeGreaterThan(0);
    const exit = computeSnapshot(doc, 950).get('r1');
    expect(exit?.__exitMode).toBe('fade');
    expect(exit?.__exitProgress).toBeGreaterThan(0);
  });

  it('omits transition bookkeeping while fully visible', () => {
    const doc = makeDoc({
      elements: [
        rectEl({
          appearances: [
            {
              start: 0,
              end: 1000,
              entryMode: 'fade',
              entryDuration: 100,
              exitMode: 'fade',
              exitDuration: 100,
            },
          ],
        }),
      ],
    });
    const state = computeSnapshot(doc, 500).get('r1');
    expect(state?.__entryMode).toBeUndefined();
    expect(state?.__exitMode).toBeUndefined();
  });

  it('carries base element properties through untouched', () => {
    const snap = computeSnapshot(makeDoc({ elements: [rectEl({ parentId: 'g1' })] }), 0);
    expect(snap.get('r1')).toMatchObject({ type: 'rect', id: 'r1', parentId: 'g1', width: 10 });
  });

  it('keys the snapshot by element id and covers every element', () => {
    const doc = makeDoc({
      elements: [rectEl({ id: 'r1' }), rectEl({ id: 'r2' }), { type: 'group', id: 'g1' }],
    });
    const snap = computeSnapshot(doc, 0);
    expect([...snap.keys()].sort()).toEqual(['g1', 'r1', 'r2']);
  });

  // Group visibility inheritance is the tree resolver's job (TASKS 1.3), not
  // this function's. Pinned so the split does not get "fixed" by accident.
  it('does not apply group visibility inheritance', () => {
    const doc = makeDoc({
      elements: [
        { type: 'group', id: 'g1', appearances: [] },
        rectEl({
          id: 'r1',
          parentId: 'g1',
          appearances: [{ start: 0, end: 1000, entryDuration: 0, exitDuration: 0 }],
        }),
      ],
    });
    const snap = computeSnapshot(doc, 500);
    expect(snap.get('g1')?.visible).toBe(false);
    expect(snap.get('r1')?.visible).toBe(true);
  });
});

// -------------------------------------------------------------- track values

describe('trackValueAt', () => {
  it('handles keyframes with duplicated time by taking the later value', () => {
    const value = trackValueAt(
      {
        property: 'x',
        keyframes: [
          { time: 100, value: 5 },
          { time: 100, value: 50 },
          { time: 500, value: 100 },
        ],
      },
      100,
    );
    expect(value).toBe(5);
    const mid = trackValueAt(
      {
        property: 'x',
        keyframes: [
          { time: 0, value: 1 },
          { time: 100, value: 5 },
          { time: 100, value: 50 },
        ],
      },
      100,
    );
    expect(mid).toBe(50);
  });

  it('returns a single keyframe value at any time', () => {
    const track = { property: 'x', keyframes: [{ time: 500, value: 42 }] };
    expect(trackValueAt(track, 0)).toBe(42);
    expect(trackValueAt(track, 500)).toBe(42);
    expect(trackValueAt(track, 9999)).toBe(42);
  });

  it('steps text values at the midpoint', () => {
    const track = {
      property: 'label',
      keyframes: [
        { time: 0, value: 'A' },
        { time: 1000, value: 'B' },
      ],
    };
    expect(trackValueAt(track, 100)).toBe('A');
    expect(trackValueAt(track, 900)).toBe('B');
  });

  it('defaults to easeInOut when a keyframe omits ease', () => {
    const track = {
      property: 'x',
      keyframes: [
        { time: 0, value: 0 },
        { time: 1000, value: 100 },
      ],
    };
    // easeInOut is symmetric, so the midpoint still lands on 50; a quarter in
    // must lag the linear value.
    expect(trackValueAt(track, 500)).toBeCloseTo(50);
    expect(trackValueAt(track, 250) as number).toBeLessThan(25);
  });

  it('distinguishes easeIn from easeOut', () => {
    const at = (ease: 'easeIn' | 'easeOut' | 'linear') =>
      trackValueAt(
        {
          property: 'x',
          keyframes: [
            { time: 0, value: 0 },
            { time: 1000, value: 100, ease },
          ],
        },
        500,
      ) as number;
    expect(at('easeIn')).not.toBe(at('easeOut'));
    expect(at('linear')).toBeCloseTo(50);
    expect(at('easeIn')).toBeLessThan(50);
    expect(at('easeOut')).toBeGreaterThan(50);
  });
});

// --------------------------------------------------------- v1 interpolate

describe('interpolate modes (v1)', () => {
  it('auto reproduces the legacy property-name heuristic', () => {
    expect(resolveBlendMode(undefined, 'x')).toBe('number');
    expect(resolveBlendMode('auto', 'x')).toBe('number');
    expect(resolveBlendMode(undefined, 'fill')).toBe('color');
    expect(resolveBlendMode(undefined, 'label')).toBe('discrete');
    expect(resolveBlendMode(undefined, 'strokeDasharray')).toBe('discrete');
    expect(resolveBlendMode(undefined, 'myCustomProp')).toBe('discrete');
  });

  it('an explicit mode overrides the heuristic', () => {
    expect(resolveBlendMode('discrete', 'x')).toBe('discrete');
    expect(resolveBlendMode('number', 'myCustomProp')).toBe('number');
    expect(resolveBlendMode('color', 'myBrandTint')).toBe('color');
  });

  it('blends a custom numeric property once told to', () => {
    const track = {
      property: 'myCustomProp',
      interpolate: 'number' as const,
      keyframes: [
        { time: 0, value: 0, ease: 'linear' as const },
        { time: 1000, value: 100, ease: 'linear' as const },
      ],
    };
    expect(trackValueAt(track, 500)).toBeCloseTo(50);
    // Without the mode it would step, which is what legacy did.
    const { interpolate: _drop, ...auto } = track;
    expect(trackValueAt(auto, 400)).toBe(0);
  });

  it('forces a discrete swap on a numeric property when asked', () => {
    const track = {
      property: 'x',
      interpolate: 'discrete' as const,
      keyframes: [
        { time: 0, value: 0 },
        { time: 1000, value: 100 },
      ],
    };
    expect(trackValueAt(track, 400)).toBe(0);
    expect(trackValueAt(track, 600)).toBe(100);
  });

  it('degrades to stepping instead of producing NaN when a mode mismatches', () => {
    expect(blendValues('a', 'b', 0.7, 'number')).toBe('b');
    expect(blendValues(1, 2, 0.7, 'color')).toBe(2);
    expect(blendValues('var(--a)', 'var(--b)', 0.2, 'color')).toBe('var(--a)');
  });

  it('classifies properties for editors without affecting blending', () => {
    expect(classifyProperty('x')).toBe('number');
    expect(classifyProperty('fill')).toBe('color');
    expect(classifyProperty('content')).toBe('text');
    expect(classifyProperty('assetId')).toBe('text');
    expect(classifyProperty('whatever')).toBe('unknown');
    // text and unknown blend identically — legacy's text branch was inert.
    expect(resolveBlendMode('auto', 'content')).toBe(resolveBlendMode('auto', 'whatever'));
  });
});

// ------------------------------------------------------------------- colors

describe('color parsing', () => {
  it('parses #rgb, #rrggbb, and #rrggbbaa', () => {
    expect(parseColor('#f00')).toEqual([255, 0, 0, 255]);
    expect(parseColor('#ff0000')).toEqual([255, 0, 0, 255]);
    expect(parseColor('#ff000080')).toEqual([255, 0, 0, 128]);
  });

  it('is case insensitive', () => {
    expect(parseColor('#ABCDEF')).toEqual(parseColor('#abcdef'));
  });

  it('rejects non-hex forms', () => {
    for (const value of ['', 'red', 'rgb(1,2,3)', 'var(--x)', '#12', '#12345', '#1234567']) {
      expect(parseColor(value), value).toBeNull();
    }
  });

  it('round-trips through rgbaToHex, dropping a fully opaque alpha', () => {
    expect(rgbaToHex(255, 0, 0, 255)).toBe('#ff0000');
    expect(rgbaToHex(255, 0, 0, 128)).toBe('#ff000080');
  });

  it('clamps out-of-range channels', () => {
    expect(rgbaToHex(-10, 300, 0, 255)).toBe('#00ff00');
  });

  it('blends short-form hex to a 6-digit result', () => {
    expect(lerpColor('#f00', '#00f', 0.5)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('keeps alpha in the result when blending 8-digit hex', () => {
    expect(lerpColor('#ff000080', '#0000ff80', 0.5)).toMatch(/^#[0-9a-f]{8}$/);
  });

  it('returns null when either side is unparseable', () => {
    expect(lerpColor('#f00', 'red', 0.5)).toBeNull();
    expect(lerpColor('nope', '#f00', 0.5)).toBeNull();
  });
});

describe('easeApply', () => {
  it('pins endpoints for every curve', () => {
    for (const ease of ['linear', 'easeIn', 'easeOut', 'easeInOut'] as const) {
      expect(easeApply(ease, 0), ease).toBeCloseTo(0);
      expect(easeApply(ease, 1), ease).toBeCloseTo(1);
    }
  });

  it('keeps easeInOut symmetric about the midpoint', () => {
    expect(easeApply('easeInOut', 0.5)).toBeCloseTo(0.5);
    expect(easeApply('easeInOut', 0.25) + easeApply('easeInOut', 0.75)).toBeCloseTo(1);
  });

  it('orders the curves as expected below the midpoint', () => {
    expect(easeApply('easeIn', 0.25)).toBeLessThan(0.25);
    expect(easeApply('easeOut', 0.25)).toBeGreaterThan(0.25);
  });
});

// ----------------------------------------------------------------- chapters

describe('currentChapter', () => {
  it('returns null when there are no chapters', () => {
    expect(currentChapter(makeDoc(), 0)).toBeNull();
  });

  it('returns the latest chapter at or before the time', () => {
    const doc = makeDoc({
      chapters: [
        { id: 'c1', time: 0 },
        { id: 'c2', time: 500 },
        { id: 'c3', time: 1000 },
      ],
    });
    expect(currentChapter(doc, 300)?.chapter.id).toBe('c1');
    expect(currentChapter(doc, 700)?.chapter.id).toBe('c2');
    expect(currentChapter(doc, 1500)?.chapter.id).toBe('c3');
  });

  it('is inclusive at a chapter boundary', () => {
    const doc = makeDoc({
      chapters: [
        { id: 'c1', time: 0 },
        { id: 'c2', time: 500 },
      ],
    });
    expect(currentChapter(doc, 500)?.chapter.id).toBe('c2');
  });

  it('returns null before the first chapter', () => {
    expect(currentChapter(makeDoc({ chapters: [{ id: 'c1', time: 500 }] }), 100)).toBeNull();
  });

  it('sorts chapters by time before picking', () => {
    const doc = makeDoc({
      chapters: [
        { id: 'c3', time: 1000 },
        { id: 'c1', time: 0 },
        { id: 'c2', time: 500 },
      ],
    });
    expect(currentChapter(doc, 300)?.chapter.id).toBe('c1');
    expect(currentChapter(doc, 300)?.index).toBe(0);
    expect(sortedChapters(doc).map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
  });

  it('reports the index within the sorted list, not the document order', () => {
    const doc = makeDoc({
      chapters: [
        { id: 'late', time: 1000 },
        { id: 'early', time: 0 },
      ],
    });
    expect(currentChapter(doc, 1500)).toMatchObject({ index: 1 });
  });
});

// ------------------------------------------------------------------ effects

describe('activeEffects', () => {
  const effect = (over: Record<string, unknown> = {}) => ({
    type: 'highlight' as const,
    id: 'e1',
    elementId: 'x',
    time: 100,
    color: '#f00',
    duration: 200,
    ...over,
  });

  it('includes effects whose window contains the time', () => {
    expect(activeEffects(makeDoc({ effects: [effect()] }), 200)).toHaveLength(1);
  });

  it('excludes effects that ended before the time', () => {
    const doc = makeDoc({ effects: [effect({ time: 0, duration: 100 })] });
    expect(activeEffects(doc, 100)).toHaveLength(0);
    expect(activeEffects(doc, 500)).toHaveLength(0);
  });

  it('treats the window as half-open: inclusive start, exclusive end', () => {
    const doc = makeDoc({ effects: [effect({ time: 100, duration: 200 })] });
    expect(activeEffects(doc, 99)).toHaveLength(0);
    expect(activeEffects(doc, 100)).toHaveLength(1);
    expect(activeEffects(doc, 299)).toHaveLength(1);
    expect(activeEffects(doc, 300)).toHaveLength(0);
  });

  it('never fires a zero-duration effect', () => {
    const doc = makeDoc({ effects: [effect({ time: 100, duration: 0 })] });
    expect(activeEffects(doc, 100)).toHaveLength(0);
  });

  it('groups active effects by target element', () => {
    const doc = makeDoc({
      effects: [
        effect({ id: 'e1', elementId: 'a' }),
        effect({ id: 'e2', elementId: 'a', type: 'pulse', scale: 1.2 }),
        effect({ id: 'e3', elementId: 'b' }),
        effect({ id: 'e4', elementId: 'c', time: 9000 }),
      ],
    });
    const byElement = activeEffectsByElement(doc, 150);
    expect(byElement.get('a')).toHaveLength(2);
    expect(byElement.get('b')).toHaveLength(1);
    expect(byElement.has('c')).toBe(false);
  });
});
