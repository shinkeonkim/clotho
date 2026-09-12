// Comparing two documents the way a person reads them.
//
// A text diff of the JSON is close to useless here. Adding one element moves
// hundreds of lines, a reordered keyframe array looks like a rewrite, and neither
// tells a reviewer what actually changed on screen. So the unit of comparison is
// the author's unit: an element moved, a track gained keyframes, a chapter shifted.
//
// This answers a different question from the visual regression suite. That one asks
// "did this break"; this one asks "what changed", and the answer is for a person.

import type { AnimationDocument } from '../schema/document';
import type { AnimationElement } from '../schema/elements';
import { effectTargets } from '../schema/effects';

export type ChangeKind = 'added' | 'removed' | 'renamed' | 'moved' | 'changed' | 'reparented';

export type ChangeScope =
  | 'element'
  | 'track'
  | 'appearance'
  | 'chapter'
  | 'effect'
  | 'checkpoint'
  | 'asset'
  | 'chart'
  | 'camera'
  | 'style'
  | 'document';

export interface DocumentChange {
  readonly scope: ChangeScope;
  readonly kind: ChangeKind;
  /** What the change is about: an element id, a chapter id, a field name. */
  readonly subject: string;
  readonly detail: string;
  /**
   * True when the change is below the noise threshold — a sub-pixel move, a value
   * that rounds to the same thing. Hidden unless the caller asks for everything.
   */
  readonly minor: boolean;
  /** Set when the pairing behind this change was inferred rather than certain. */
  readonly inferred?: boolean;
}

export interface RenameGuess {
  readonly from: string;
  readonly to: string;
  /** 0..1. Only pairs well above the floor are reported at all. */
  readonly confidence: number;
}

export interface DiffResult {
  readonly changes: readonly DocumentChange[];
  readonly renames: readonly RenameGuess[];
}

export interface DiffOptions {
  /**
   * Try to recognize an element that was renamed rather than replaced.
   *
   * "12 elements removed, 12 added" is technically true and useless; "12 elements
   * were renamed" is what happened. It is a guess, so it is marked as one and can be
   * turned off.
   */
  readonly detectRenames?: boolean;
  /** Movements below this many canvas units are reported as minor. Default 2. */
  readonly moveThreshold?: number;
}

const DEFAULT_MOVE_THRESHOLD = 2;
/** Below this similarity two elements are not the same element under a new name. */
const RENAME_FLOOR = 0.6;

type Record_ = Record<string, unknown>;

function isPlainObject(value: unknown): value is Record_ {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Compare loosely enough that 1.0000000001 and 1 are the same number. */
function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) < 1e-6 || (Number.isNaN(a) && Number.isNaN(b));
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

function short(value: unknown): string {
  if (typeof value === 'number') return String(Number(value.toFixed(3)));
  if (typeof value === 'string') return value.length > 40 ? `${value.slice(0, 37)}…` : value;
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 40 ? `${text.slice(0, 37)}…` : text;
}

/** Positional fields, which are reported as a move rather than as a field change. */
const POSITION_FIELDS = new Set(['x', 'y', 'cx', 'cy', 'x1', 'y1', 'x2', 'y2']);
/** Fields compared structurally by their own pass rather than field by field. */
const STRUCTURAL_FIELDS = new Set(['tracks', 'appearances', 'id', 'type', 'parentId']);

function positionOf(element: AnimationElement): { x: number; y: number } | null {
  const record = element as unknown as Record_;
  const pick = (...keys: string[]): number | null => {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'number') return value;
    }
    return null;
  };
  const x = pick('x', 'cx', 'x1');
  const y = pick('y', 'cy', 'y1');
  return x === null || y === null ? null : { x, y };
}

function sizeOf(element: AnimationElement): { width: number; height: number } {
  const record = element as unknown as Record_;
  if (typeof record.r === 'number') return { width: record.r * 2, height: record.r * 2 };
  return {
    width: typeof record.width === 'number' ? record.width : 0,
    height: typeof record.height === 'number' ? record.height : 0,
  };
}

/**
 * How alike two elements are, for rename detection.
 *
 * Type has to match outright — a rect is never a renamed circle — and the rest is
 * how close they sit and how close their sizes are. Deliberately crude: this is a
 * hint offered to a reader, not a decision the tool acts on.
 */
export function similarity(a: AnimationElement, b: AnimationElement): number {
  if (a.type !== b.type) return 0;

  const posA = positionOf(a);
  const posB = positionOf(b);
  const sizeA = sizeOf(a);
  const sizeB = sizeOf(b);

  const distance =
    posA && posB ? Math.hypot(posA.x - posB.x, posA.y - posB.y) : posA || posB ? 400 : 0;
  const positionScore = Math.max(0, 1 - distance / 400);

  const sizeDelta = Math.abs(sizeA.width - sizeB.width) + Math.abs(sizeA.height - sizeB.height);
  const sizeScore = Math.max(0, 1 - sizeDelta / 400);

  const trackScore = a.tracks.length === b.tracks.length ? 1 : 0.5;

  return 0.45 * positionScore + 0.35 * sizeScore + 0.2 * trackScore;
}

/**
 * Pair up removed and added elements that look like renames.
 *
 * Greedy over the best-scoring pairs, which is enough for the shape this actually
 * takes — an author renaming a run of `cell-0…7` to `slot-0…7` — and avoids the
 * complexity of an optimal assignment for a hint.
 */
function guessRenames(
  removed: readonly AnimationElement[],
  added: readonly AnimationElement[],
): RenameGuess[] {
  const pairs: RenameGuess[] = [];
  for (const from of removed) {
    for (const to of added) {
      const confidence = similarity(from, to);
      if (confidence >= RENAME_FLOOR) pairs.push({ from: from.id, to: to.id, confidence });
    }
  }
  pairs.sort((a, b) => b.confidence - a.confidence);

  const usedFrom = new Set<string>();
  const usedTo = new Set<string>();
  const chosen: RenameGuess[] = [];
  for (const pair of pairs) {
    if (usedFrom.has(pair.from) || usedTo.has(pair.to)) continue;
    usedFrom.add(pair.from);
    usedTo.add(pair.to);
    chosen.push(pair);
  }
  return chosen;
}

function diffElementFields(
  before: AnimationElement,
  after: AnimationElement,
  subject: string,
  moveThreshold: number,
  inferred: boolean,
  out: DocumentChange[],
): void {
  const a = before as unknown as Record_;
  const b = after as unknown as Record_;

  const posBefore = positionOf(before);
  const posAfter = positionOf(after);
  if (posBefore && posAfter) {
    const distance = Math.hypot(posAfter.x - posBefore.x, posAfter.y - posBefore.y);
    if (distance > 1e-6) {
      out.push({
        scope: 'element',
        kind: 'moved',
        subject,
        detail: `(${short(posBefore.x)}, ${short(posBefore.y)}) → (${short(posAfter.x)}, ${short(posAfter.y)})`,
        minor: distance < moveThreshold,
        ...(inferred ? { inferred } : {}),
      });
    }
  }

  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (STRUCTURAL_FIELDS.has(key)) continue;
    if (POSITION_FIELDS.has(key)) continue;
    if (sameValue(a[key], b[key])) continue;
    out.push({
      scope: 'element',
      kind: 'changed',
      subject: `${subject}.${key}`,
      detail:
        a[key] === undefined
          ? `set to ${short(b[key])}`
          : b[key] === undefined
            ? `unset (was ${short(a[key])})`
            : `${short(a[key])} → ${short(b[key])}`,
      minor: false,
      ...(inferred ? { inferred } : {}),
    });
  }

  if (a.parentId !== b.parentId) {
    out.push({
      scope: 'element',
      kind: 'reparented',
      subject,
      detail: `${a.parentId ?? '(root)'} → ${b.parentId ?? '(root)'}`,
      minor: false,
    });
  }

  diffTracks(before, after, subject, out);
  diffAppearances(before, after, subject, out);
}

function diffTracks(
  before: AnimationElement,
  after: AnimationElement,
  subject: string,
  out: DocumentChange[],
): void {
  const byProperty = (element: AnimationElement) =>
    new Map(element.tracks.map((track) => [track.property, track]));
  const a = byProperty(before);
  const b = byProperty(after);

  for (const [property, track] of a) {
    const other = b.get(property);
    if (!other) {
      out.push({
        scope: 'track',
        kind: 'removed',
        subject: `${subject}.${property}`,
        detail: `${track.keyframes.length} keyframe(s) removed`,
        minor: false,
      });
      continue;
    }
    if (track.keyframes.length !== other.keyframes.length) {
      out.push({
        scope: 'track',
        kind: 'changed',
        subject: `${subject}.${property}`,
        detail: `${track.keyframes.length} → ${other.keyframes.length} keyframes`,
        minor: false,
      });
      continue;
    }
    if (!sameValue(track.keyframes, other.keyframes) || track.interpolate !== other.interpolate) {
      out.push({
        scope: 'track',
        kind: 'changed',
        subject: `${subject}.${property}`,
        detail: 'keyframe values changed',
        minor: false,
      });
    }
  }

  for (const [property, track] of b) {
    if (a.has(property)) continue;
    out.push({
      scope: 'track',
      kind: 'added',
      subject: `${subject}.${property}`,
      detail: `${track.keyframes.length} keyframe(s)`,
      minor: false,
    });
  }
}

function diffAppearances(
  before: AnimationElement,
  after: AnimationElement,
  subject: string,
  out: DocumentChange[],
): void {
  if (sameValue(before.appearances, after.appearances)) return;
  const span = (element: AnimationElement) =>
    element.appearances.map((a) => `${a.start}–${a.end}`).join(', ') || '(none)';
  out.push({
    scope: 'appearance',
    kind: 'changed',
    subject,
    detail: `${span(before)} → ${span(after)}`,
    minor: false,
  });
}

function diffKeyed<T extends { id: string }>(
  before: readonly T[],
  after: readonly T[],
  scope: ChangeScope,
  describe: (item: T) => string,
  out: DocumentChange[],
): void {
  const a = new Map(before.map((item) => [item.id, item]));
  const b = new Map(after.map((item) => [item.id, item]));

  for (const [id, item] of a) {
    const other = b.get(id);
    if (!other) {
      out.push({ scope, kind: 'removed', subject: id, detail: describe(item), minor: false });
      continue;
    }
    if (!sameValue(item, other)) {
      out.push({
        scope,
        kind: 'changed',
        subject: id,
        detail: `${describe(item)} → ${describe(other)}`,
        minor: false,
      });
    }
  }
  for (const [id, item] of b) {
    if (a.has(id)) continue;
    out.push({ scope, kind: 'added', subject: id, detail: describe(item), minor: false });
  }
}

/** Document-level fields worth naming individually rather than as one blob. */
const DOCUMENT_FIELDS = [
  'title',
  'description',
  'category',
  'duration',
  'tags',
  'locales',
  'updatedAt',
] as const;

export function diffDocuments(
  before: AnimationDocument,
  after: AnimationDocument,
  options: DiffOptions = {},
): DiffResult {
  const moveThreshold = options.moveThreshold ?? DEFAULT_MOVE_THRESHOLD;
  const detectRenames = options.detectRenames ?? true;
  const changes: DocumentChange[] = [];

  for (const field of DOCUMENT_FIELDS) {
    if (sameValue(before[field], after[field])) continue;
    changes.push({
      scope: 'document',
      kind: 'changed',
      subject: field,
      detail: `${short(before[field])} → ${short(after[field])}`,
      minor: field === 'updatedAt',
    });
  }

  for (const field of ['canvas', 'settings', 'data', 'camera', 'style'] as const) {
    if (sameValue(before[field], after[field])) continue;
    changes.push({
      scope: field === 'camera' ? 'camera' : field === 'style' ? 'style' : 'document',
      kind:
        before[field] === undefined ? 'added' : after[field] === undefined ? 'removed' : 'changed',
      subject: field,
      detail: `${short(before[field])} → ${short(after[field])}`,
      minor: false,
    });
  }

  const beforeById = new Map(before.elements.map((element) => [element.id, element]));
  const afterById = new Map(after.elements.map((element) => [element.id, element]));

  const removed = before.elements.filter((element) => !afterById.has(element.id));
  const added = after.elements.filter((element) => !beforeById.has(element.id));

  const renames = detectRenames ? guessRenames(removed, added) : [];
  const renamedFrom = new Map(renames.map((rename) => [rename.from, rename.to]));
  const renamedTo = new Set(renames.map((rename) => rename.to));

  for (const element of before.elements) {
    const counterpart = afterById.get(element.id);
    if (counterpart) {
      diffElementFields(element, counterpart, element.id, moveThreshold, false, changes);
      continue;
    }
    const newId = renamedFrom.get(element.id);
    if (newId === undefined) {
      changes.push({
        scope: 'element',
        kind: 'removed',
        subject: element.id,
        detail: element.type,
        minor: false,
      });
      continue;
    }
    changes.push({
      scope: 'element',
      kind: 'renamed',
      subject: element.id,
      detail: `→ ${newId}`,
      minor: false,
      inferred: true,
    });
    diffElementFields(
      element,
      afterById.get(newId)!,
      `${element.id}→${newId}`,
      moveThreshold,
      true,
      changes,
    );
  }

  for (const element of added) {
    if (renamedTo.has(element.id)) continue;
    changes.push({
      scope: 'element',
      kind: 'added',
      subject: element.id,
      detail: element.type,
      minor: false,
    });
  }

  diffKeyed(
    before.chapters,
    after.chapters,
    'chapter',
    (chapter) => `${chapter.time}ms ${chapter.label || '(unlabelled)'}`,
    changes,
  );
  diffKeyed(
    before.effects,
    after.effects,
    'effect',
    (effect) => `${effect.type} on ${effectTargets(effect).join(', ')} at ${effect.time}ms`,
    changes,
  );
  diffKeyed(
    before.checkpoints,
    after.checkpoints,
    'checkpoint',
    (checkpoint) => `${checkpoint.interaction} at ${checkpoint.time}ms`,
    changes,
  );
  diffKeyed(before.charts, after.charts, 'chart', (chart) => `${chart.kind} chart`, changes);

  const assetIds = new Set([...Object.keys(before.assets), ...Object.keys(after.assets)]);
  for (const id of assetIds) {
    const a = before.assets[id];
    const b = after.assets[id];
    if (sameValue(a, b)) continue;
    changes.push({
      scope: 'asset',
      kind: a === undefined ? 'added' : b === undefined ? 'removed' : 'changed',
      subject: id,
      detail: isPlainObject(b)
        ? String(b.kind ?? '')
        : isPlainObject(a)
          ? String(a.kind ?? '')
          : '',
      minor: false,
    });
  }

  return { changes, renames };
}

/** Changes worth showing by default — everything unless it is noise. */
export function significantChanges(result: DiffResult): DocumentChange[] {
  return result.changes.filter((change) => !change.minor);
}
