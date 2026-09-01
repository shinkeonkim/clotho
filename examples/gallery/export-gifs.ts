// Generate the README gallery with the same public API available to consumers.
// Keep one file per document so readers can inspect each animation independently.

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { animationDocumentSchema } from '../../src/core/schema/document';
import { writeDocumentGif } from '../../src/node/gif';
import { GALLERY } from './documents';

const outputDir = new URL('../../docs/assets/gallery/', import.meta.url).pathname;
await mkdir(outputDir, { recursive: true });

for (const entry of GALLERY) {
  const doc = animationDocumentSchema.parse(entry.doc);
  const output = join(outputDir, `${entry.slug}.gif`);
  await writeDocumentGif(doc, output, {
    fps: 8,
    width: 540,
    background: '#fafafa',
    assetResolver: entry.assetResolver,
  });
  console.log(`wrote ${output}`);
}
