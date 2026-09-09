// Typesetting a `math` element at authoring time.
//
// #10 shipped the element with a runtime `mathRenderer` hook, which is right for an
// editor preview and wrong for a published document: every consumer — blog, docs
// site, GIF renderer — has to configure a typesetter, and any one that forgets shows
// TeX source where an equation should be. Worse, the result then depends on which
// version of the typesetter happened to be installed, which makes a visual
// regression impossible to attribute.
//
// Baking moves the decision to authoring time. The expression is typeset once,
// lowered to `path` elements, and the document becomes self-contained: four adapters
// plus SVG and GIF all draw the same thing with no configuration.
//
// Where the source goes was the question that held this back, and the answer is the
// one the chart compiler already established: the authored thing stays, and
// compilation *adds* primitives with predictable ids. So the `math` element is not
// replaced. It keeps `tex`, `alt`, its appearance window and its tracks, and becomes
// the parent of its own typeset result — which is why baking changes nothing about
// how the expression is positioned, animated or read aloud.

import type { AnimationDocument } from '../schema/document';
import type { AnimationElement, MathElement, PathElement } from '../schema/elements';
import type { Appearance } from '../schema/primitives';
import { ID_SEPARATOR } from '../chart/ids';
import { resolveElementColor } from '../theme/colors';

/** A `path` the typesetter produced, in the element's own coordinate space. */
export interface BakedGlyph {
  readonly d: string;
  readonly fill?: string;
  readonly stroke?: string;
  readonly strokeWidth?: number;
}

export interface MathBakeOutput {
  readonly glyphs: readonly BakedGlyph[];
  /** Typesetter name and version, recorded on the element. e.g. `katex@0.16.11`. */
  readonly bakedBy: string;
}

/**
 * Turns a `math` element into paths.
 *
 * Returning null means "I could not typeset this", which leaves the element alone —
 * unbaked, still rendering through the runtime hook or the source fallback. A baker
 * that throws is not caught: a typesetter blowing up during a build is a build
 * failure, not something to paper over.
 */
export type MathBaker = (element: MathElement) => MathBakeOutput | null;

/** Id of the `n`th glyph baked from `mathId`. */
export function bakedGlyphId(mathId: string, index: number): string {
  return `${mathId}${ID_SEPARATOR}glyph-${index}`;
}

/** Whether `element` is a glyph a previous bake produced for `mathId`. */
function isBakedGlyph(element: AnimationElement, mathId: string): boolean {
  return element.parentId === mathId && element.id.startsWith(`${mathId}${ID_SEPARATOR}glyph-`);
}

export interface BakeResult {
  readonly document: AnimationDocument;
  /** Ids of the `math` elements that were baked, in document order. */
  readonly baked: readonly string[];
  /** Ids the baker declined, which still need a runtime typesetter. */
  readonly skipped: readonly string[];
}

/**
 * Bake every `math` element the baker can typeset.
 *
 * A pure document transform, and idempotent: glyphs from a previous bake are
 * discarded before the baker runs, so baking twice — or baking again after the `tex`
 * changed — produces the same document as baking once. That is the property the
 * plugin pipeline's `verifyDeterminism` asserts, and it is what makes baking safe in
 * a build step that may run more than once.
 */
export function bakeMathElements(doc: AnimationDocument, baker: MathBaker): BakeResult {
  const mathIds = new Set(doc.elements.filter((el) => el.type === 'math').map((el) => el.id));
  // Previous output is dropped first, so a re-bake starts from the document as
  // authored rather than from what the last run left behind.
  const authored = doc.elements.filter(
    (el) =>
      el.parentId === undefined || !mathIds.has(el.parentId) || !isBakedGlyph(el, el.parentId),
  );

  const baked: string[] = [];
  const skipped: string[] = [];
  const elements: AnimationElement[] = [];

  for (const element of authored) {
    if (element.type !== 'math') {
      elements.push(element);
      continue;
    }

    // Handed to the baker without whatever a previous run recorded, so a baker
    // cannot accidentally come to depend on its own past output.
    const { bakedBy: _previous, ...rest } = element;
    const source = rest as MathElement;
    const output = baker(source);

    if (!output || output.glyphs.length === 0) {
      skipped.push(element.id);
      elements.push(source);
      continue;
    }

    baked.push(element.id);
    elements.push({ ...source, bakedBy: output.bakedBy });
    output.glyphs.forEach((glyph, index) => elements.push(glyphElement(source, glyph, index)));
  }

  return { document: { ...doc, elements }, baked, skipped };
}

/**
 * One glyph as a `path` element.
 *
 * Only the appearance window is copied down. Position comes from the parent's
 * transform, so a glyph's own coordinates stay in the typesetter's space, and tracks
 * stay on the `math` element, where animating `x` moves the whole expression as it
 * always did. The window has to be copied because an element with no appearances is
 * never visible — it is the one thing a child does not inherit.
 */
/**
 * Colour for a glyph the typesetter did not colour itself.
 *
 * The `math` element's colour goes through the same theme resolution the unbaked
 * element gets, because baking freezes a render-time decision into the document and
 * freezing the wrong one makes a baked equation invisible on a dark stage: `#18181b`
 * is the schema default for "foreground", and a `path` fill is never rewritten the
 * way a `text` colour is. An authored colour is left exactly as authored.
 */
function glyphFill(parent: MathElement): string {
  return resolveElementColor(parent.color, 'text') ?? parent.color;
}

function glyphElement(parent: MathElement, glyph: BakedGlyph, index: number): PathElement {
  return {
    type: 'path',
    id: bakedGlyphId(parent.id, index),
    parentId: parent.id,
    x: 0,
    y: 0,
    d: glyph.d,
    fill: glyph.fill ?? glyphFill(parent),
    stroke: glyph.stroke ?? 'none',
    strokeWidth: glyph.strokeWidth ?? 0,
    opacity: 1,
    rotation: 0,
    appearances: parent.appearances as Appearance[],
    tracks: [],
    bindings: [],
  };
}
