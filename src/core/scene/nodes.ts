// The scene graph: what a frame looks like, as data.
//
// This is the interface every adapter is built on (docs/ARCHITECTURE.md §3). The
// legacy engine emitted React elements directly, which is why supporting Vue or
// vanilla DOM would have meant reimplementing all seven renderers three more times.
//
// **Attribute names are spelled exactly as SVG spells them** — `stroke-width`,
// `text-anchor`, `preserveAspectRatio`, `xml:space`. That makes the svg-string, DOM,
// and Vue adapters verbatim pass-throughs, and leaves the React adapter one
// mechanical `kebab → camel` conversion (which correctly leaves SVG's genuinely
// camelCase names like `preserveAspectRatio` alone, since they contain no dash).

import type { Size } from '../geometry/stage';
import type { Chapter } from '../schema/document';
import type { ActiveChapter } from '../runtime/chapters';

export type SceneAttrValue = string | number | undefined;
export type SceneAttrs = Record<string, SceneAttrValue>;

export interface SceneStyle {
  readonly opacity?: number;
  /**
   * CSS `color`. Arrow markers are filled with `currentColor` so they inherit the
   * connector's stroke; this is how that gets set.
   */
  readonly color?: string;
}

export type SceneShapeKind = 'rect' | 'circle' | 'line' | 'path' | 'polygon' | 'image';
export type SceneNodeKind = 'g' | 'text' | SceneShapeKind;

interface SceneNodeBase {
  /** Stable identity for adapters that reconcile between frames. */
  readonly key: string;
  readonly attrs: SceneAttrs;
  readonly style?: SceneStyle;
}

export interface SceneGroup extends SceneNodeBase {
  readonly kind: 'g';
  readonly children: readonly SceneNode[];
}

export interface SceneShape extends SceneNodeBase {
  readonly kind: SceneShapeKind;
}

/** A `<tspan>`; nests to express per-token coloring inside a line of code. */
export interface SceneTspan {
  readonly key: string;
  readonly attrs: SceneAttrs;
  readonly content?: string;
  readonly spans?: readonly SceneTspan[];
}

export interface SceneText extends SceneNodeBase {
  readonly kind: 'text';
  /** Literal text content, when the element has no internal structure. */
  readonly content?: string;
  /** Used instead of `content` for multi-line or multi-color text. */
  readonly spans?: readonly SceneTspan[];
}

export type SceneNode = SceneGroup | SceneShape | SceneText;

/**
 * Reusable definitions, emitted as nodes rather than as a markup string.
 *
 * Legacy injected these through `dangerouslySetInnerHTML`, which no serializer or
 * DOM patcher could inspect. As nodes they travel the same path as everything else.
 */
export interface SceneDef {
  readonly key: string;
  readonly kind: 'marker';
  readonly attrs: SceneAttrs;
  readonly children: readonly SceneNode[];
}

export type SceneDiagnosticCode =
  'unresolved-connector' | 'unresolved-asset' | 'pending-asset' | 'tree-issue';

/**
 * Something the scene could not render, reported rather than swallowed.
 *
 * Legacy returned `null` from a renderer in these cases and nothing said why.
 * Diagnostics let an editor surface the reason while the rest of the frame draws.
 */
export interface SceneDiagnostic {
  readonly code: SceneDiagnosticCode;
  readonly elementId: string;
  readonly message: string;
}

export interface Scene {
  readonly canvas: Size;
  /** `0 0 <width> <height>`. */
  readonly viewBox: string;
  /** CSS `aspect-ratio` value for the stage element. */
  readonly aspectRatio: string;
  /** Resolved background to paint on the `<svg>`. */
  readonly background: string;
  /** Whether the themed stage mat should show behind a transparent canvas. */
  readonly showMat: boolean;
  /** Accessible label for the stage. */
  readonly title: string;
  readonly defs: readonly SceneDef[];
  readonly nodes: readonly SceneNode[];
  readonly chapter: ActiveChapter | null;
  readonly chapters: readonly Chapter[];
  readonly time: number;
  readonly diagnostics: readonly SceneDiagnostic[];
}

/** Drop undefined entries so adapters never emit empty attributes. */
export function compactAttrs(attrs: SceneAttrs): SceneAttrs {
  const out: SceneAttrs = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined && value !== '') out[key] = value;
  }
  return out;
}

/** Walk every node in the scene, depth first. */
export function* walkScene(nodes: readonly SceneNode[]): Generator<SceneNode> {
  for (const node of nodes) {
    yield node;
    if (node.kind === 'g') yield* walkScene(node.children);
  }
}

/** Count nodes, for tests and diagnostics. */
export function countNodes(nodes: readonly SceneNode[]): number {
  let count = 0;
  for (const _node of walkScene(nodes)) count += 1;
  return count;
}
