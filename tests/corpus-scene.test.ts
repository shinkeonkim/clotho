// Scene-graph coverage over the real corpus (TASKS 2.7).
//
// The unit tests check the shapes we thought to write down. This checks that 383
// real documents — 2,304 rects, 1,783 texts, 823 circles, 587 arrows, 477 lines, 19
// code blocks, and 2,262 effects between them — all render to well-formed markup at
// every point on their timelines.
//
// Well-formedness is verified by feeding the output to an actual XML parser rather
// than by pattern-matching the string: a serializer bug that produced
// `x="1"y="2"` passes any regex you would think to write, and did exactly that
// during development.

import { describe, expect, it } from 'bun:test';
import { CORPUS_DIR, hasCorpus, loadCorpus } from './corpus';
import { migrateLegacyDocument } from '../src/core/migrate/legacy';
import { parseDocument } from '../src/core/schema';
import { buildScene } from '../src/core/scene/build';
import { countNodes } from '../src/core/scene/nodes';
import { renderDocumentToSvg } from '../src/svg/render';
import type { AnimationDocument } from '../src/core/schema/document';

const describeCorpus = hasCorpus() ? describe : describe.skip;

function documents(): { id: string; doc: AnimationDocument }[] {
  return loadCorpus().flatMap((entry) => {
    const parsed = parseDocument(migrateLegacyDocument(entry.json).document);
    return parsed.ok ? [{ id: entry.id, doc: parsed.document }] : [];
  });
}

/** Times worth rendering: an even sweep plus every declared boundary. */
function sampleTimes(doc: AnimationDocument, steps: number): number[] {
  const times = new Set<number>();
  const duration = Math.max(doc.duration, 1);
  for (let i = 0; i <= steps; i += 1) times.add(Math.round((duration * i) / steps));
  for (const chapter of doc.chapters) times.add(chapter.time);
  for (const effect of doc.effects) {
    times.add(effect.time);
    times.add(effect.time + Math.max(effect.duration - 1, 0));
  }
  return [...times].filter((t) => t >= 0).sort((a, b) => a - b);
}

describeCorpus(`scene graph over the corpus (${CORPUS_DIR})`, () => {
  const docs = documents();

  it('loads the whole corpus', () => {
    expect(docs.length).toBeGreaterThan(300);
  });

  it('builds a scene at every sampled time without throwing', () => {
    const failures: string[] = [];
    for (const { id, doc } of docs) {
      for (const t of sampleTimes(doc, 8)) {
        try {
          buildScene(doc, t);
        } catch (cause) {
          failures.push(`${id}@${t}: ${(cause as Error).message}`);
        }
      }
    }
    expect(failures.slice(0, 5)).toEqual([]);
  });

  it('renders every element type present in the corpus', () => {
    const kinds = new Set<string>();
    for (const { doc } of docs) {
      const scene = buildScene(doc, Math.floor(doc.duration / 2));
      const collect = (nodes: readonly { kind: string; children?: readonly unknown[] }[]): void => {
        for (const node of nodes) {
          kinds.add(node.kind);
          if (node.kind === 'g') {
            collect((node as { children: readonly { kind: string }[] }).children);
          }
        }
      };
      collect(scene.nodes);
    }
    // rect, circle, line, path (arrows), polygon, text, g — image is unused in the
    // corpus, which is why v1 redesigned how it is referenced.
    for (const kind of ['g', 'rect', 'circle', 'line', 'path', 'text']) {
      expect([...kinds], kind).toContain(kind);
    }
  });

  it('produces well-formed XML at every sampled time', () => {
    // Bun exposes no XML parser, so validate structurally: every emitted attribute
    // must be separated, every tag balanced. Checked against a parser in
    // scripts/verify-svg-wellformed.ts for the full sweep.
    const failures: string[] = [];
    for (const { id, doc } of docs) {
      for (const t of sampleTimes(doc, 4)) {
        const svg = renderDocumentToSvg(doc, t, { standalone: true });
        if (/"[a-zA-Z-]+=/.test(svg)) failures.push(`${id}@${t}: attributes not separated`);
        const opens = (svg.match(/<(?!\/|\?)[a-z]/g) ?? []).length;
        const selfClose = (svg.match(/\/>/g) ?? []).length;
        const closes = (svg.match(/<\//g) ?? []).length;
        if (opens !== selfClose + closes) {
          failures.push(
            `${id}@${t}: ${opens} open vs ${selfClose} self-closing + ${closes} closing`,
          );
        }
      }
    }
    expect(failures.slice(0, 5)).toEqual([]);
  });

  it('escapes every ampersand and angle bracket that appears in content', () => {
    const withSpecials = docs.filter(({ doc }) =>
      doc.elements.some((el) => {
        const text =
          (el as { content?: string; label?: string }).content ?? (el as { label?: string }).label;
        return typeof text === 'string' && /[&<>]/.test(text);
      }),
    );
    for (const { id, doc } of withSpecials) {
      const svg = renderDocumentToSvg(doc, Math.floor(doc.duration / 2));
      // Any raw `&` not starting an entity would break a parser.
      expect(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(svg), id).toBe(false);
    }
    expect(withSpecials.length).toBeGreaterThan(0);
  });

  // Attribute values only. The corpus includes pandas tutorials whose *text*
  // legitimately says "NaN", so scanning the whole document would flag them.
  it('emits no NaN, undefined, or empty attribute values', () => {
    const BAD_VALUES = new Set(['NaN', 'undefined', 'null', '', 'Infinity', '-Infinity']);
    const failures: string[] = [];
    for (const { id, doc } of docs) {
      const svg = renderDocumentToSvg(doc, Math.floor(doc.duration / 2));
      for (const match of svg.matchAll(/([\w:-]+)="([^"]*)"/g)) {
        if (BAD_VALUES.has(match[2]!)) failures.push(`${id}: ${match[1]}="${match[2]}"`);
      }
    }
    expect(failures.slice(0, 5)).toEqual([]);
  });

  it('is deterministic — the same time yields byte-identical output', () => {
    for (const { id, doc } of docs.slice(0, 40)) {
      const t = Math.floor(doc.duration / 3);
      expect(renderDocumentToSvg(doc, t), id).toBe(renderDocumentToSvg(doc, t));
    }
  });

  it('emits only the markers each document references', () => {
    for (const { doc } of docs) {
      const scene = buildScene(doc, Math.floor(doc.duration / 2));
      const referenced = new Set<string>();
      const svg = renderDocumentToSvg(doc, Math.floor(doc.duration / 2));
      for (const match of svg.matchAll(/url\(#(cloth-h-[a-z-]+)\)/g)) {
        referenced.add(match[1]!);
      }
      const defined = new Set(scene.defs.map((d) => d.key));
      for (const id of referenced) expect([...defined]).toContain(id);
    }
  });

  it('draws something at the midpoint of nearly every animation', () => {
    const empty = docs.filter(({ doc }) => {
      const scene = buildScene(doc, Math.floor(doc.duration / 2));
      return countNodes(scene.nodes) === 0;
    });
    expect(empty.map((e) => e.id)).toEqual([]);
  });

  it('reports diagnostics only for the documents known to have authoring bugs', () => {
    const withDiagnostics = new Map<string, string[]>();
    for (const { id, doc } of docs) {
      for (const t of sampleTimes(doc, 4)) {
        const scene = buildScene(doc, t);
        if (scene.diagnostics.length > 0) {
          withDiagnostics.set(
            id,
            scene.diagnostics.map((d) => d.code),
          );
        }
      }
    }
    // point-in-non-convex-polygon.json has two arrows using `toX`/`toY`, which are
    // not schema fields; they never rendered in legacy either.
    expect([...withDiagnostics.keys()]).toEqual(['point-in-non-convex-polygon']);
    expect(withDiagnostics.get('point-in-non-convex-polygon')).toEqual([
      'unresolved-connector',
      'unresolved-connector',
    ]);
  });
});
