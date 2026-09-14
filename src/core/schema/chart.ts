// Charts: an authoring-time spec that compiles to ordinary elements.
//
// `charts` sits beside `layouts` rather than inside `elements`, and that placement
// is the design. A chart is a rule for producing primitives, not a thing the
// renderer draws — so the four adapters, the GIF renderer and the editor's element
// switch never learn it exists, and the render path pays nothing for it.
//
// What the compiler actually contracts to produce is a set of **stable ids**
// (docs/SCHEMA-V1.md §2.15). That is what lets `pulse`, `spotlight`, annotations and
// camera focus address the third bar of the second series with no chart-specific
// syntax at all.

import { z } from 'zod';
import { easeSchema, idSchema } from './primitives';

export const chartKindSchema = z.enum(['bar', 'line']);

/** `auto` reads the extent from the data; a number pins that end. */
const domainBoundSchema = z.union([z.number(), z.literal('auto')]);

export const linearScaleSpecSchema = z.object({
  type: z.literal('linear'),
  domain: z.tuple([domainBoundSchema, domainBoundSchema]).optional(),
  /** Round the domain outward to values a reader can name. */
  nice: z.boolean().default(true),
});

export const bandScaleSpecSchema = z.object({
  type: z.literal('band'),
  /** Fraction of each slot left as gap, so bars do not touch. */
  padding: z.number().min(0).max(0.99).default(0.2),
});

export const scaleSpecSchema = z.discriminatedUnion('type', [
  linearScaleSpecSchema,
  bandScaleSpecSchema,
]);

export const axisSpecSchema = z.object({
  label: z.string().default(''),
  /** Requested tick count; the compiler may emit fewer to avoid overlap. */
  ticks: z.number().int().min(0).max(50).default(5),
  grid: z.boolean().default(false),
  /** Hide the axis line and its ticks but keep the space. */
  hidden: z.boolean().default(false),
});

/**
 * How the data arrives on screen.
 *
 * Every mode compiles to ordinary property tracks and appearance windows, so a
 * `reveal` is a shorthand an author can also write out by hand — and can override
 * after compiling.
 */
export const revealSpecSchema = z.object({
  mode: z.enum(['none', 'grow', 'sweep', 'series']).default('none'),
  start: z.number().int().min(0).default(0),
  duration: z.number().int().min(0).default(1200),
  /** Delay added per series (or per point, for `grow`). */
  stagger: z.number().int().min(0).default(0),
  ease: easeSchema.optional(),
});

export const chartSchema = z.object({
  id: idSchema,
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  kind: chartKindSchema,
  /** Rows, as objects. Numbers and strings only — this is a chart, not a database. */
  data: z.array(z.record(z.union([z.string(), z.number(), z.boolean(), z.null()]))).default([]),
  encode: z.object({
    x: z.string().min(1),
    y: z.string().min(1),
    /** Field whose value names the series. Absent means one unnamed series. */
    series: z.string().min(1).optional(),
  }),
  scale: z
    .object({ x: scaleSpecSchema.optional(), y: scaleSpecSchema.optional() })
    .default({}),
  axes: z.object({ x: axisSpecSchema.default({}), y: axisSpecSchema.default({}) }).default({}),
  reveal: revealSpecSchema.default({}),
  /** Series colors, in the order the series first appear. */
  palette: z.array(z.string()).default([]),
  legend: z.boolean().default(false),
  /** Window during which the compiled elements are on stage. */
  appearance: z
    .object({ start: z.number().int().min(0).default(0), end: z.number().int().min(0) })
    .optional(),
});

export type ChartKind = z.infer<typeof chartKindSchema>;
export type ScaleSpec = z.infer<typeof scaleSpecSchema>;
export type AxisSpec = z.infer<typeof axisSpecSchema>;
export type RevealSpec = z.infer<typeof revealSpecSchema>;
export type Chart = z.infer<typeof chartSchema>;
