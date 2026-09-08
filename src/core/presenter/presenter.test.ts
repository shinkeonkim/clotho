// Chapter segments.
//
// A segment rather than an instant is the whole idea: advancing plays the step, and
// the arithmetic that says where a step ends belongs to the document.

import { describe, expect, it } from 'bun:test';
import { animationDocumentSchema } from '../schema/document';
import type { AnimationDocument } from '../schema/document';
import { chapterSegments, segmentAt } from './index';

function animation(chapters: Record<string, unknown>[] = []): AnimationDocument {
  return animationDocumentSchema.parse({
    clothoVersion: 1,
    id: 'talk',
    title: 'Talk',
    description: 'a description',
    duration: 9000,
    chapters,
  });
}

const chaptered = animation([
  { id: 'a', time: 0, label: 'One', notes: 'ask about complexity' },
  { id: 'b', time: 3000, label: 'Two' },
  { id: 'c', time: 6000, label: 'Three' },
]);

describe('chapterSegments', () => {
  it('runs each chapter up to the next one', () => {
    expect(chapterSegments(chaptered).map((s) => [s.from, s.to])).toEqual([
      [0, 3000],
      [3000, 6000],
      [6000, 9000],
    ]);
  });

  it('runs the last chapter to the end of the document', () => {
    expect(chapterSegments(chaptered).at(-1)!.to).toBe(9000);
  });

  it('carries the label and the speaker notes', () => {
    const first = chapterSegments(chaptered)[0]!;
    expect(first.label).toBe('One');
    expect(first.notes).toBe('ask about complexity');
  });

  it('falls back to the chapter id when there is no label', () => {
    expect(chapterSegments(animation([{ id: 'bare', time: 0 }]))[0]!.label).toBe('bare');
  });

  it('treats a document with no chapters as one segment', () => {
    const segments = chapterSegments(animation());
    expect(segments).toHaveLength(1);
    expect([segments[0]!.from, segments[0]!.to]).toEqual([0, 9000]);
    expect(segments[0]!.label).toBe('Talk');
  });

  it('sorts chapters authored out of order', () => {
    const jumbled = animation([
      { id: 'late', time: 5000 },
      { id: 'early', time: 1000 },
    ]);
    expect(chapterSegments(jumbled).map((s) => s.id)).toEqual(['early', 'late']);
  });

  it('clamps a chapter past the end of the document', () => {
    const overrun = animation([{ id: 'past', time: 99_000 }]);
    expect(chapterSegments(overrun)[0]!.from).toBe(9000);
  });

  it('produces a zero-length segment for chapters sharing a time', () => {
    // Nothing to play; the presenter checks for this rather than running on.
    const same = animation([
      { id: 'a', time: 2000 },
      { id: 'b', time: 2000 },
    ]);
    const [first] = chapterSegments(same);
    expect(first!.to - first!.from).toBe(0);
  });
});

describe('segmentAt', () => {
  const segments = chapterSegments(chaptered);

  it('finds the segment containing a time', () => {
    expect(segmentAt(segments, 0).id).toBe('a');
    expect(segmentAt(segments, 3500).id).toBe('b');
    expect(segmentAt(segments, 8999).id).toBe('c');
  });

  it('returns the first segment for a time before everything', () => {
    expect(segmentAt(segments, -100).id).toBe('a');
  });

  it('returns the last segment at the very end', () => {
    expect(segmentAt(segments, 9000).id).toBe('c');
  });
});
