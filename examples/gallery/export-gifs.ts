// Generate the README gallery with the same public API available to consumers.
// Keep one file per document so readers can inspect each animation independently.

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { animationDocumentSchema } from '../../src/core/schema/document';
import { writeDocumentGif } from '../../src/node/gif';
import { GALLERY } from './documents';

const outputDir = new URL('../../docs/assets/gallery/', import.meta.url).pathname;
await mkdir(outputDir, { recursive: true });
const localFont = '/System/Library/Fonts/Supplemental/Arial.ttf';

for (const entry of GALLERY) {
  const doc = animationDocumentSchema.parse(entry.doc);
  const output = join(outputDir, `${entry.slug}.gif`);
  await writeDocumentGif(doc, output, {
    fps: 8,
    width: 540,
    background: '#fafafa',
    assetResolver: entry.assetResolver,
    fontFiles: existsSync(localFont) ? [localFont] : undefined,
  });
  console.log(`wrote ${output}`);
}
