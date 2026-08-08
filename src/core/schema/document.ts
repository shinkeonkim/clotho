// The clotho v1 document envelope (docs/SCHEMA-V1.md §1).
//
// `clothoVersion` both identifies the format and marks the document as clotho's.
// Legacy documents carry `version: 3 | 4` instead and must pass through
// core/migrate before the runtime will accept them — the two versions had
// identical schemas, so the split carried no information and is gone.

import { z } from 'zod';
import { idSchema } from './primitives';
import { elementSchema } from './elements';
import { effectSchema } from './effects';
import { assetMapSchema } from './assets';

/** Current document format version emitted and accepted by this build. */
export const FORMAT_VERSION = 1;

export const canvasSchema = z.object({
  width: z.number().int().positive().default(800),
  height: z.number().int().positive().default(500),
  background: z.string().default('transparent'),
});

export const chapterSchema = z.object({
  id: idSchema,
  time: z.number().int().min(0),
  label: z.string().default(''),
  subtitle: z.string().default(''),
});

/**
 * Author intent for playback. Player options override these at runtime, so a
 * host can force-pause every animation on a page without editing documents.
 */
export const settingsSchema = z.object({
  loop: z.boolean().default(true),
  autoplay: z.boolean().default(true),
  showCaption: z.boolean().default(false),
  showChapterList: z.boolean().default(false),
});

const CANVAS_DEFAULT = { width: 800, height: 500, background: 'transparent' } as const;
const SETTINGS_DEFAULT = {
  loop: true,
  autoplay: true,
  showCaption: false,
  showChapterList: false,
} as const;

export const animationDocumentSchema = z.object({
  clothoVersion: z.literal(FORMAT_VERSION),
  /** Optional JSON Schema URL for editor autocomplete. Ignored at runtime. */
  $schema: z.string().optional(),
  id: idSchema,
  title: z.string().default(''),
  description: z.string().default(''),
  /**
   * Free-form. Legacy pinned this to a seven-value enum drawn from one blog's
   * taxonomy; a general-purpose package has no business fixing users' categories.
   */
  category: z.string().default('general'),
  tags: z.array(z.string()).default([]),
  duration: z.number().int().min(0).default(5000),
  canvas: canvasSchema.default(CANVAS_DEFAULT),
  assets: assetMapSchema.default({}),
  elements: z.array(elementSchema).default([]),
  chapters: z.array(chapterSchema).default([]),
  effects: z.array(effectSchema).default([]),
  settings: settingsSchema.default(SETTINGS_DEFAULT),
  updatedAt: z.string().optional(),
});

export type Canvas = z.infer<typeof canvasSchema>;
export type Chapter = z.infer<typeof chapterSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type AnimationDocument = z.infer<typeof animationDocumentSchema>;

/**
 * True when the value looks like a clotho v1 document. Cheap structural probe for
 * routing input to the parser or the migrator — not a substitute for parsing.
 */
export function isClothoDocument(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { clothoVersion?: unknown }).clothoVersion === FORMAT_VERSION
  );
}

/**
 * True when the value looks like a legacy (pre-clotho) document, i.e. it carries
 * `version: 3 | 4` and no `clothoVersion`. Such documents need core/migrate.
 */
export function isLegacyDocument(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { clothoVersion?: unknown; version?: unknown };
  if (v.clothoVersion !== undefined) return false;
  return v.version === 3 || v.version === 4;
}
