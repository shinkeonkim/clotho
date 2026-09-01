// Shared leaf schemas: identifiers, easing, anchors, entry/exit modes, arrow
// heads, timeline appearances, and property tracks.
//
// Ported from the legacy engine's schema/primitives.ts (identical in both
// reference implementations apart from the zod import). Two v1 additions,
// documented in docs/SCHEMA-V1.md:
//   - `parentId` on every element, replacing group.childIds (§2.1)
//   - `interpolate` on property tracks, replacing the hardcoded key sets (§2.2)

import { z } from 'zod';

/**
 * Element / chapter / effect / asset identifier.
 *
 * Deliberately unchanged from legacy: all 383 existing documents conform, and
 * tightening or loosening it would break migration for no gain.
 */
export const ID_RE = /^[a-z0-9][a-z0-9_-]*$/;

export const idSchema = z
  .string()
  .regex(
    ID_RE,
    'id must be lowercase letters, digits, "-" or "_", starting with a letter or digit',
  );

/** BCP 47-style language tag used by document and element localization maps. */
export const localeTagSchema = z
  .string()
  .regex(
    /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/,
    'locale must be a BCP 47 language tag such as "ko", "en", "ja", or "zh-CN"',
  );

export const DEFAULT_LOCALES = ['ko', 'en'] as const;

export const localeListSchema = z
  .array(localeTagSchema)
  .min(1)
  .refine((locales) => new Set(locales.map((locale) => locale.toLowerCase())).size === locales.length, {
    message: 'locales must not contain duplicates',
  });

export const easeSchema = z.enum(['linear', 'easeIn', 'easeOut', 'easeInOut']).default('easeInOut');

export const anchorSchema = z
  .enum([
    'auto',
    'top',
    'right',
    'bottom',
    'left',
    'center',
    'top-left',
    'top-right',
    'bottom-left',
    'bottom-right',
  ])
  .default('auto');

const TRANSITION_MODES = [
  'instant',
  'fade',
  'slide-left',
  'slide-right',
  'slide-up',
  'slide-down',
  'zoom',
  'pop',
] as const;

export const entryModeSchema = z.enum(TRANSITION_MODES).default('instant');
export const exitModeSchema = z.enum(TRANSITION_MODES).default('instant');

export const arrowHeadSchema = z.enum([
  'none',
  'arrow',
  'triangle',
  'triangle-open',
  'circle',
  'circle-open',
  'diamond',
  'diamond-open',
  'bar',
]);

export const trackValueSchema = z.union([z.string(), z.number(), z.boolean()]);

/**
 * How consecutive keyframe values are blended.
 *
 * Legacy decided this from hardcoded property-name sets (`NUMERIC_KEYS`,
 * `COLOR_KEYS`, `TEXT_KEYS` in schema/keys.ts), so any property outside those
 * sets silently fell back to stepping and custom properties were impossible.
 * `auto` preserves that heuristic — which is what makes migration lossless —
 * while an explicit value overrides it.
 */
export const interpolationSchema = z.enum(['auto', 'number', 'color', 'discrete']).default('auto');

export const trackKeyframeSchema = z.object({
  time: z.number().int().min(0),
  value: trackValueSchema,
  ease: easeSchema.optional(),
});

export const propertyTrackSchema = z.object({
  property: z.string().min(1),
  interpolate: interpolationSchema.optional(),
  keyframes: z.array(trackKeyframeSchema).min(1),
});

/**
 * A window during which the element is on stage, with optional entry/exit
 * transitions. Multiple appearances let one element come and go repeatedly.
 */
export const appearanceSchema = z.object({
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  entryMode: entryModeSchema.optional(),
  entryDuration: z.number().int().min(0).default(300),
  exitMode: exitModeSchema.optional(),
  exitDuration: z.number().int().min(0).default(300),
});

/**
 * Fields every element carries.
 *
 * `parentId` is the v1 grouping mechanism: a flat element array plus a parent
 * pointer, rather than legacy's `group.childIds` reference list. Flat storage
 * keeps editor operations cheap (reparenting is one field, id lookup is O(1))
 * and the scene builder materializes the tree at render time.
 */
export const baseElementProps = {
  id: idSchema,
  name: z.string().optional(),
  parentId: idSchema.optional(),
  rotation: z.number().default(0),
  appearances: z.array(appearanceSchema).default([]),
  tracks: z.array(propertyTrackSchema).default([]),
};

export type Anchor = z.infer<typeof anchorSchema>;
export type ArrowHead = z.infer<typeof arrowHeadSchema>;
export type EntryMode = z.infer<typeof entryModeSchema>;
export type ExitMode = z.infer<typeof exitModeSchema>;
export type Ease = z.infer<typeof easeSchema>;
export type Interpolation = z.infer<typeof interpolationSchema>;
export type Appearance = z.infer<typeof appearanceSchema>;
export type TrackValue = z.infer<typeof trackValueSchema>;
export type TrackKeyframe = z.infer<typeof trackKeyframeSchema>;
export type PropertyTrack = z.infer<typeof propertyTrackSchema>;
export type LocaleTag = z.infer<typeof localeTagSchema>;
