// The ten element types (docs/SCHEMA-V1.md §3).
//
// Ported from the legacy engine's schema/elements.ts with every default value
// preserved verbatim — migration must be lossless, and defaults are what
// unspecified fields in the 383 existing documents resolve to.
//
// Two element shapes change in v1:
//   - `image`: `src` string → `assetId` into the document asset registry (§2.3)
//   - `group`: `childIds` list → children point up via `parentId` (§2.1)

import { z } from 'zod';
import { anchorSchema, annotationReferencesSchema, arrowHeadSchema, baseElementProps, idSchema, localeListSchema, localeTagSchema } from './primitives';
import { codeSourceSchema } from './source';

export const rectElementSchema = z.object({
  type: z.literal('rect'),
  ...baseElementProps,
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  fill: z.string().default('#a5b4fc'),
  stroke: z.string().default('#6366f1'),
  strokeWidth: z.number().nonnegative().default(1.5),
  cornerRadius: z.number().nonnegative().default(8),
  label: z.string().optional(),
  labelColor: z.string().default('#0b0b0f'),
  labelSize: z.number().positive().default(14),
  subtitle: z.string().optional(),
  subtitleSize: z.number().positive().optional(),
});

export const circleElementSchema = z.object({
  type: z.literal('circle'),
  ...baseElementProps,
  cx: z.number(),
  cy: z.number(),
  r: z.number().positive(),
  fill: z.string().default('#a5b4fc'),
  stroke: z.string().default('#6366f1'),
  strokeWidth: z.number().nonnegative().default(1.5),
  label: z.string().optional(),
  labelColor: z.string().default('#0b0b0f'),
  labelSize: z.number().positive().default(14),
});

/**
 * Connector endpoints resolve either from anchored elements (`fromId`/`toId`)
 * or from explicit coordinates. Both are optional in the schema because either
 * pair may be used; the runtime resolves whichever is present.
 */
const connectorProps = {
  fromId: idSchema.optional(),
  toId: idSchema.optional(),
  fromAnchor: anchorSchema.optional(),
  toAnchor: anchorSchema.optional(),
  x1: z.number().optional(),
  y1: z.number().optional(),
  x2: z.number().optional(),
  y2: z.number().optional(),
  strokeDasharray: z.string().optional(),
  headStart: arrowHeadSchema.optional(),
  headEnd: arrowHeadSchema.optional(),
};

export const lineElementSchema = z.object({
  type: z.literal('line'),
  ...baseElementProps,
  ...connectorProps,
  stroke: z.string().default('#6366f1'),
  strokeWidth: z.number().positive().default(2),
});

export const arrowElementSchema = z.object({
  type: z.literal('arrow'),
  ...baseElementProps,
  ...connectorProps,
  stroke: z.string().default('#6366f1'),
  strokeWidth: z.number().positive().default(2),
  label: z.string().optional(),
  labelColor: z.string().default('#0b0b0f'),
  labelOffsetX: z.number().default(0),
  labelOffsetY: z.number().default(4),
  curvature: z.number().default(0),
});

export const textElementSchema = z.object({
  type: z.literal('text'),
  ...baseElementProps,
  x: z.number(),
  y: z.number(),
  content: z.string(),
  /** Optional per-element override for the document's language list. */
  locales: localeListSchema.optional(),
  /** Localized alternatives. `content` remains the default and final fallback. */
  translations: z.record(localeTagSchema, z.string()).default({}),
  /** `{token}` names in content and translations mapped to target element ids. */
  references: annotationReferencesSchema,
  fontSize: z.number().positive().default(16),
  fontWeight: z.union([z.string(), z.number()]).default(400),
  color: z.string().default('#18181b'),
  textAnchor: z.enum(['start', 'middle', 'end']).default('start'),
});

export const imageElementSchema = z.object({
  type: z.literal('image'),
  ...baseElementProps,
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  /** Key into the document's `assets` map. Validated for existence in core/validate. */
  assetId: z.string().min(1),
  /** Accessible description. Legacy had no a11y text path for images at all. */
  alt: z.string().optional(),
  preserveAspectRatio: z.string().default('xMidYMid meet'),
  opacity: z.number().min(0).max(1).default(1),
});

export const pathElementSchema = z.object({
  type: z.literal('path'),
  ...baseElementProps,
  x: z.number().default(0),
  y: z.number().default(0),
  d: z.string(),
  fill: z.string().default('none'),
  stroke: z.string().default('#6366f1'),
  strokeWidth: z.number().nonnegative().default(2),
  strokeDasharray: z.string().optional(),
  /**
   * Offset into the dash pattern.
   *
   * On its own it does nothing useful; tracked against a dash the length of the
   * path, it draws the path on. That is how the chart compiler's `sweep` reveal
   * works, and it is the one stroke property `strokeDasharray` was missing.
   */
  strokeDashoffset: z.number().optional(),
  opacity: z.number().min(0).max(1).default(1),
});

export const polygonElementSchema = z.object({
  type: z.literal('polygon'),
  ...baseElementProps,
  points: z.string(),
  fill: z.string().default('#a5b4fc'),
  stroke: z.string().default('#6366f1'),
  strokeWidth: z.number().nonnegative().default(1.5),
  opacity: z.number().min(0).max(1).default(1),
});

/**
 * A transform + visibility container. Children are the elements whose
 * `parentId` is this group's id, in document order, and their coordinates are
 * relative to this group's origin.
 */
export const groupElementSchema = z.object({
  type: z.literal('group'),
  ...baseElementProps,
  x: z.number().default(0),
  y: z.number().default(0),
});

export const codeElementSchema = z.object({
  type: z.literal('code'),
  ...baseElementProps,
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  content: z.string(),
  language: z.string().default('javascript'),
  fontSize: z.number().positive().default(12),
  showLineNumbers: z.boolean().default(false),
  fill: z.string().default('#1e293b'),
  textColor: z.string().default('#e2e8f0'),
  padding: z.number().nonnegative().default(12),
  cornerRadius: z.number().nonnegative().default(8),
  title: z.string().optional(),
  /**
   * Where `content` came from (docs/SCHEMA-V1.md §2.17).
   *
   * Metadata only. The runtime never reads the file — `content` is authoritative at
   * render time, which is what keeps a document exportable and embeddable. `clotho
   * sync` refreshes it and `clotho validate` reports when it has fallen behind.
   */
  source: codeSourceSchema.optional(),
});

/**
 * A TeX expression, typeset by the host rather than by clotho.
 *
 * Algorithm and data-structure documents need recurrences, complexity bounds and
 * invariants, and the two things authors did instead both lose something: unicode in
 * a `text` element cannot express a fraction or a sum, and a screenshot cannot follow
 * the theme, survive a zoom, or have one of its terms pulsed.
 *
 * `tex` stays in the document even after typesetting, so the expression can be
 * re-edited and read aloud. Typesetters are large — larger than this whole core — so
 * one is never bundled; see `MathRenderer` and `bakeMathElements`.
 */
export const mathElementSchema = z.object({
  type: z.literal('math'),
  ...baseElementProps,
  x: z.number(),
  y: z.number(),
  tex: z.string(),
  /** `block` centers on its own line's baseline; `inline` sits on the text baseline. */
  display: z.enum(['block', 'inline']).default('block'),
  fontSize: z.number().positive().default(18),
  color: z.string().default('#18181b'),
  textAnchor: z.enum(['start', 'middle', 'end']).default('start'),
  /** Spoken form, for readers who cannot see the typeset result. */
  alt: z.string().optional(),
  /**
   * Typesetter that produced this element's baked children, e.g. `katex@0.16.11`.
   *
   * Set by `bakeMathElements`. Recorded because a typeset result depends on the
   * typesetter's version, and a visual regression that moves by half a pixel is
   * otherwise impossible to attribute.
   */
  bakedBy: z.string().optional(),
});

export const elementSchema = z.discriminatedUnion('type', [
  rectElementSchema,
  circleElementSchema,
  lineElementSchema,
  arrowElementSchema,
  textElementSchema,
  imageElementSchema,
  pathElementSchema,
  polygonElementSchema,
  groupElementSchema,
  codeElementSchema,
  mathElementSchema,
]);

export type RectElement = z.infer<typeof rectElementSchema>;
export type CircleElement = z.infer<typeof circleElementSchema>;
export type LineElement = z.infer<typeof lineElementSchema>;
export type ArrowElement = z.infer<typeof arrowElementSchema>;
export type TextElement = z.infer<typeof textElementSchema>;
export type ImageElement = z.infer<typeof imageElementSchema>;
export type PathElement = z.infer<typeof pathElementSchema>;
export type PolygonElement = z.infer<typeof polygonElementSchema>;
export type GroupElement = z.infer<typeof groupElementSchema>;
export type CodeElement = z.infer<typeof codeElementSchema>;
export type MathElement = z.infer<typeof mathElementSchema>;
export type AnimationElement = z.infer<typeof elementSchema>;
export type ElementType = AnimationElement['type'];

/**
 * The eleven element type names, as a runtime value.
 *
 * `ElementType` is a compile-time union; anything that has to *enumerate* the types —
 * an editor's insert menu, a validator, a JSON Schema consumer — needs them at runtime
 * too, and deriving both from one list keeps them from drifting.
 */
export const elementTypeSchema = z.enum([
  'rect',
  'circle',
  'line',
  'arrow',
  'text',
  'image',
  'path',
  'polygon',
  'group',
  'code',
  'math',
]);

export const ELEMENT_TYPES = elementTypeSchema.options;

/** Element types whose endpoints may anchor to other elements. */
export const CONNECTOR_TYPES = ['line', 'arrow'] as const;

export function isConnector(el: AnimationElement): el is LineElement | ArrowElement {
  return el.type === 'line' || el.type === 'arrow';
}

// Re-exported so the public API is one import, while the render path can reach the
// zod-free module directly (see ./containers.ts).
export { canContainChildren } from './containers';
