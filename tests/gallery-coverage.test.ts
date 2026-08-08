// The gallery is only worth having if it stays complete.
//
// An examples directory rots in a specific way: the schema grows a mode, nobody adds a
// demonstration of it, and a year later the examples describe a format that no longer
// exists. So completeness is asserted against the schema itself rather than against a
// list somebody has to remember to update — add an arrowhead to the enum and this test
// fails until the gallery draws it.
//
// It also parses and validates every document, which is the cheaper half of the point:
// an example that does not parse is worse than no example.

import { describe, expect, it } from 'bun:test';
import { GALLERY } from '../examples/gallery/documents';
import { animationDocumentSchema } from '../src/core/schema/document';
import { elementSchema } from '../src/core/schema/elements';
import { effectSchema } from '../src/core/schema/effects';
import {
  anchorSchema,
  arrowHeadSchema,
  easeSchema,
  entryModeSchema,
  interpolationSchema,
} from '../src/core/schema/primitives';
import { validateDocument } from '../src/core/validate/validate';
import { buildScene } from '../src/core/scene/build';
import type { SceneNode } from '../src/core/scene/nodes';
import { renderDocumentToSvg } from '../src/svg/render';

const parsed = GALLERY.map((entry) => ({
  ...entry,
  doc: animationDocumentSchema.parse(entry.doc),
}));

/**
 * The enum values behind a schema, whether or not it carries a `.default()`.
 *
 * `z.enum([...]).default(x)` is a ZodDefault wrapping the enum, and reaching for
 * `.options` on it silently yields undefined — a coverage test that throws is better
 * than one that quietly checks nothing, but neither is the goal.
 */
function optionsOf(schema: {
  options?: readonly string[];
  removeDefault?: () => { options: readonly string[] };
}): readonly string[] {
  return schema.options ?? schema.removeDefault!().options;
}

/** Every value of `key` used anywhere in the gallery, at any depth. */
function used(pick: (node: Record<string, unknown>) => unknown): Set<unknown> {
  const out = new Set<unknown>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    const node = value as Record<string, unknown>;
    const found = pick(node);
    if (found !== undefined) out.add(found);
    Object.values(node).forEach(walk);
  };
  parsed.forEach((entry) => walk(entry.doc));
  return out;
}

describe('the gallery is valid', () => {
  it.each(parsed.map((e) => [e.slug, e] as const))('%s parses and validates', (_slug, entry) => {
    const result = validateDocument(entry.doc);
    // Errors are failures. Warnings are not, necessarily — but the gallery has none, so
    // asserting on the whole list keeps an accidental one from going unnoticed.
    expect(result.findings).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('has unique slugs and document ids', () => {
    expect(new Set(parsed.map((e) => e.slug)).size).toBe(parsed.length);
    expect(new Set(parsed.map((e) => e.doc.id)).size).toBe(parsed.length);
  });

  it('every entry explains what to look for', () => {
    for (const entry of parsed) expect(entry.note.length).toBeGreaterThan(20);
  });
});

describe('the gallery covers the schema', () => {
  it('draws every element type', () => {
    const types = new Set(elementSchema.options.map((o) => o.shape.type.value));
    expect([...types].filter((t) => !used((n) => n.type).has(t))).toEqual([]);
  });

  it('fires every effect type', () => {
    const types = new Set(effectSchema.options.map((o) => o.shape.type.value));
    expect([...types].filter((t) => !used((n) => n.type).has(t))).toEqual([]);
  });

  it('shows every entry mode', () => {
    const seen = used((n) => n.entryMode);
    // `instant` is the schema default, so an appearance that names no mode is using it;
    // the transitions document names it explicitly rather than relying on that.
    expect(optionsOf(entryModeSchema).filter((m) => !seen.has(m))).toEqual([]);
  });

  it('shows every exit mode', () => {
    const seen = used((n) => n.exitMode);
    expect(optionsOf(entryModeSchema).filter((m) => !seen.has(m))).toEqual([]);
  });

  it('shows every easing curve', () => {
    const seen = used((n) => n.ease);
    expect(optionsOf(easeSchema).filter((e) => !seen.has(e))).toEqual([]);
  });

  it('shows every interpolation mode', () => {
    const seen = used((n) => n.interpolate);
    expect(optionsOf(interpolationSchema).filter((m) => !seen.has(m))).toEqual([]);
  });

  it('shows every arrowhead', () => {
    const seen = new Set([...used((n) => n.headStart), ...used((n) => n.headEnd)]);
    expect(optionsOf(arrowHeadSchema).filter((h) => !seen.has(h))).toEqual([]);
  });

  it('shows every anchor', () => {
    const seen = new Set([...used((n) => n.fromAnchor), ...used((n) => n.toAnchor)]);
    expect(optionsOf(anchorSchema).filter((a) => !seen.has(a))).toEqual([]);
  });

  it('shows every asset kind', () => {
    const kinds = new Set(parsed.flatMap((e) => Object.values(e.doc.assets).map((a) => a.kind)));
    // `external` points at a URL the gallery has no business fetching while offline,
    // so it is covered by tests/assets rather than here.
    expect(kinds).toContain('inline');
    expect(kinds).toContain('ref');
  });

  it('uses chapters, nesting, and multiple appearances somewhere', () => {
    expect(parsed.some((e) => e.doc.chapters.length > 1)).toBe(true);
    expect(parsed.some((e) => e.doc.elements.some((el) => el.parentId !== undefined))).toBe(true);
    expect(parsed.some((e) => e.doc.elements.some((el) => el.appearances.length > 1))).toBe(true);
    // Nesting two levels deep is what distinguishes a real tree from a flat container.
    expect(
      parsed.some((e) =>
        e.doc.elements.some((el) => {
          const parent = e.doc.elements.find((p) => p.id === el.parentId);
          return parent?.parentId !== undefined;
        }),
      ),
    ).toBe(true);
  });
});

describe('the gallery renders', () => {
  // Building a scene at several times is what catches a document that parses but is
  // nonsense — an unresolvable connector, an element referring to a missing parent.
  it.each(parsed.map((e) => [e.slug, e] as const))(
    '%s builds a scene throughout',
    (_slug, entry) => {
      const options = entry.assetResolver ? { assetResolver: entry.assetResolver } : {};
      for (let i = 0; i <= 8; i += 1) {
        const time = Math.round((entry.doc.duration * i) / 8);
        const scene = buildScene(entry.doc, time, options);
        expect(scene.diagnostics).toEqual([]);
        expect(renderDocumentToSvg(entry.doc, time, options)).toContain('<svg');
      }
    },
  );

  // The other half of the `ref` demonstration: without a resolver the scene still
  // builds, reports exactly what is unresolved, and keeps the element's box.
  it('degrades to a placeholder when a ref asset has no resolver', () => {
    const entry = parsed.find((e) => e.assetResolver)!;
    const scene = buildScene(entry.doc, 0);
    expect(scene.diagnostics.map((d) => d.code)).toEqual(['unresolved-asset']);
    expect(scene.nodes.length).toBe(
      buildScene(entry.doc, 0, {
        assetResolver: entry.assetResolver,
      }).nodes.length,
    );
  });

  // Hand-placed coordinates drift off the canvas silently: the SVG is still valid, the
  // scene still builds, and the shape is simply not in the picture. Only geometry
  // catches that, and a page nobody can open catches nothing.
  it.each(parsed.map((e) => [e.slug, e] as const))('%s stays inside its canvas', (_slug, entry) => {
    const options = entry.assetResolver ? { assetResolver: entry.assetResolver } : {};
    const xs: number[] = [];
    const ys: number[] = [];
    const visit = (node: SceneNode): void => {
      const attrs = node.attrs as Record<string, unknown>;
      const n = (key: string): number | undefined =>
        typeof attrs[key] === 'number' ? (attrs[key] as number) : undefined;
      for (const key of ['x', 'x1', 'x2', 'cx']) {
        const v = n(key);
        if (v !== undefined) xs.push(v);
      }
      for (const key of ['y', 'y1', 'y2', 'cy']) {
        const v = n(key);
        if (v !== undefined) ys.push(v);
      }
      const [x, w, y, h] = [n('x'), n('width'), n('y'), n('height')];
      if (x !== undefined && w !== undefined) xs.push(x + w);
      if (y !== undefined && h !== undefined) ys.push(y + h);
      // Only container nodes have children; shapes are leaves.
      if ('children' in node) node.children?.forEach(visit);
    };
    for (let i = 0; i <= 8; i += 1) {
      buildScene(entry.doc, Math.round((entry.doc.duration * i) / 8), options).nodes.forEach(visit);
    }
    // Coordinates inside a group are relative to it, so the bound is a smoke test for
    // gross mistakes — a shape parked 300px off the right edge — not a tight fit.
    const { width, height } = entry.doc.canvas;
    expect({ minX: Math.min(...xs) >= -40, maxX: Math.max(...xs) <= width + 40 }).toEqual({
      minX: true,
      maxX: true,
    });
    expect({ minY: Math.min(...ys) >= -40, maxY: Math.max(...ys) <= height + 40 }).toEqual({
      minY: true,
      maxY: true,
    });
  });

  it('every document puts something on stage at every sampled time', () => {
    for (const entry of parsed) {
      for (let i = 0; i <= 8; i += 1) {
        const time = Math.round((entry.doc.duration * i) / 8);
        const scene = buildScene(entry.doc, time);
        expect({ slug: entry.slug, time, empty: scene.nodes.length === 0 }).toMatchObject({
          empty: false,
        });
      }
    }
  });
});
