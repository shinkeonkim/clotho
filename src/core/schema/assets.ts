// Image asset registry (docs/SCHEMA-V1.md §2.3).
//
// Legacy put a raw URL in `image.src`, which tied a document to one host's paths
// and made it non-portable — plausibly why `image` is used 0 times across the
// 383 existing documents. v1 keeps sources in a document-level registry so a
// document can be self-contained (`inline`), point outward (`external`), or defer
// to the host (`ref`).

import { z } from 'zod';

/** Rejects the `data:<mime>;base64,` prefix authors habitually paste in. */
const DATA_URI_PREFIX = /^data:/i;
/** Standard base64, optional padding, whitespace tolerated (JSON line wrapping). */
const BASE64_BODY = /^[A-Za-z0-9+/\s]*={0,2}$/;

export const base64Schema = z
  .string()
  .min(1)
  .refine((v) => !DATA_URI_PREFIX.test(v), {
    message:
      'expected raw base64 without a "data:...;base64," prefix — the prefix duplicates `mime`',
  })
  .refine((v) => BASE64_BODY.test(v), { message: 'not valid base64' });

/**
 * Restricted to images: assets feed SVG `<image href>`. `image/svg+xml` is
 * allowed because scripts do not execute in SVG referenced through `<image>`.
 */
export const imageMimeSchema = z
  .string()
  .regex(/^image\/[a-z0-9.+-]+$/i, 'mime must be an image/* type');

export const inlineAssetSchema = z.object({
  kind: z.literal('inline'),
  mime: imageMimeSchema,
  data: base64Schema,
});

export const externalAssetSchema = z.object({
  kind: z.literal('external'),
  url: z.string().min(1),
});

/**
 * Host-resolved reference. The consumer supplies an `AssetResolver` that turns
 * `key` into a URL or data URI; until it resolves, the renderer draws a
 * placeholder so layout does not shift.
 */
export const refAssetSchema = z.object({
  kind: z.literal('ref'),
  key: z.string().min(1),
});

export const assetSchema = z.discriminatedUnion('kind', [
  inlineAssetSchema,
  externalAssetSchema,
  refAssetSchema,
]);

/**
 * An object map rather than an array: asset lookup is O(1) and duplicate ids are
 * structurally impossible.
 */
export const assetMapSchema = z.record(z.string().min(1), assetSchema);

export type InlineAsset = z.infer<typeof inlineAssetSchema>;
export type ExternalAsset = z.infer<typeof externalAssetSchema>;
export type RefAsset = z.infer<typeof refAssetSchema>;
export type Asset = z.infer<typeof assetSchema>;
export type AssetMap = z.infer<typeof assetMapSchema>;
export type AssetKind = Asset['kind'];
