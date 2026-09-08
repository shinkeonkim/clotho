// Where a `code` element's text came from.
//
// `content` is a string literal, so the moment it is copied out of a real file there
// are two copies and they start drifting. A function gets renamed, lines shift, and
// the animation keeps showing the old code with nothing to say so. In a repository
// that has carried 383 documents for a while, that is a matter of time rather than
// of care.
//
// This records the provenance. It does not make the document depend on the file:
// `content` stays inline, always, because a browser cannot read `src/core/...` and a
// document that needs the filesystem cannot be exported to SVG, baked into a GIF, or
// embedded anywhere.

import { z } from 'zod';

/**
 * A named span in the source, marked by comments.
 *
 * Line numbers are the obvious way to point at code and the fragile one: insert a
 * line above and every range below is wrong, silently. A region survives edits
 * because it is anchored to the code rather than to the file's shape.
 */
export const codeRegionSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/, 'region names may contain letters, digits, "-" and "_"');

export const codeSourceSchema = z
  .object({
    /** Path relative to the project root, as `clotho sync` is invoked from it. */
    file: z.string().min(1),
    /** `// #region <name>` … `// #endregion` in the source. Preferred over `lines`. */
    region: codeRegionSchema.optional(),
    /** 1-based, inclusive at both ends. Simple, and wrong as soon as lines move. */
    lines: z.tuple([z.number().int().positive(), z.number().int().positive()]).optional(),
    /**
     * Hash of the extracted text when it was last synced.
     *
     * The whole point of the feature: `clotho validate` compares this against the
     * file and reports a document that has fallen behind its own source.
     */
    hash: z.string().optional(),
    /** Git revision the text was taken from, for a snippet that is meant to be old. */
    rev: z.string().optional(),
  })
  .refine((value) => value.region === undefined || value.lines === undefined, {
    message: 'source may specify region or lines, not both',
  });

export type CodeRegion = z.infer<typeof codeRegionSchema>;
export type CodeSource = z.infer<typeof codeSourceSchema>;
