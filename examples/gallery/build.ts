// Write the gallery out as files: JSON documents and SVG filmstrips.
//
// Two audiences. Someone learning the format wants to read a document as an author
// would write it, and `documents.ts` is generated in places — so the JSON is the honest
// artifact to read. Someone reviewing a change wants to see whether the pictures moved,
// and a directory of SVGs diffs where a running page does not.
//
// Usage: bun examples/gallery/build.ts [outDir]   (default: examples/gallery/out)

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GALLERY } from './documents';
import { parseDocumentOrThrow } from '../../src/core/index';
import { renderDocumentToSvg } from '../../src/svg/index';

const outDir = process.argv[2] ?? 'examples/gallery/out';
const FRAMES = 9;

mkdirSync(join(outDir, 'documents'), { recursive: true });
mkdirSync(join(outDir, 'frames'), { recursive: true });

for (const entry of GALLERY) {
  const doc = parseDocumentOrThrow(entry.doc);
  const options = entry.assetResolver ? { assetResolver: entry.assetResolver } : {};

  // The authored document, not the parsed one: defaults filled in by zod would triple
  // its length and teach the reader that they are required.
  writeFileSync(
    join(outDir, 'documents', `${entry.slug}.json`),
    `${JSON.stringify(entry.doc, null, 2)}\n`,
    'utf-8',
  );

  for (let i = 0; i < FRAMES; i += 1) {
    const time = Math.round((doc.duration * i) / (FRAMES - 1));
    // `standalone` because these are files opened on their own, with no stylesheet for
    // var(--cloth-fg) to resolve against.
    const svg = renderDocumentToSvg(doc, time, { ...options, standalone: true, pretty: true });
    writeFileSync(
      join(outDir, 'frames', `${entry.slug}-${String(time).padStart(5, '0')}ms.svg`),
      svg,
      'utf-8',
    );
  }
  console.log(`${entry.slug.padEnd(14)} 1 document · ${FRAMES} frames`);
}

console.log(`\n${GALLERY.length} documents → ${outDir}`);
