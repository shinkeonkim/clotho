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
import { anchorSchema, arrowHeadSchema, baseElementProps, idSchema } from './primitives';

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
export type AnimationElement = z.infer<typeof elementSchema>;
export type ElementType = AnimationElement['type'];

/** Element types whose endpoints may anchor to other elements. */
export const CONNECTOR_TYPES = ['line', 'arrow'] as const;

export function isConnector(
  el: AnimationElement,
): el is LineElement | ArrowElement {
  return el.type === 'line' || el.type === 'arrow';
}
