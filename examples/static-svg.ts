// Render frames to standalone .svg files — no DOM, no framework.
//
// The same call underlies thumbnails, server-side rendering, and static export. It is
// also how the scene graph gets verified: a frame is a pure function of (document,
// time), so its output is comparable byte for byte.
//
// Usage: bun examples/static-svg.ts [outDir]

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocumentOrThrow } from '../src/core/index';
import { renderDocumentToSvg } from '../src/svg/index';

const outDir = process.argv[2] ?? 'examples/out';
const json = JSON.parse(readFileSync(new URL('./shared/document.json', import.meta.url), 'utf-8'));
const doc = parseDocumentOrThrow(json);

mkdirSync(outDir, { recursive: true });

const FRAMES = 6;
for (let i = 0; i < FRAMES; i += 1) {
  const time = Math.round((doc.duration * i) / (FRAMES - 1));
  // `standalone` adds the XML prolog and namespaces, and keeps authored colors
  // verbatim — a file on its own has no stylesheet for var(--cloth-fg) to resolve in.
  const svg = renderDocumentToSvg(doc, time, { standalone: true, pretty: true });
  const file = join(outDir, `${doc.id}-${String(time).padStart(5, '0')}ms.svg`);
  writeFileSync(file, svg, 'utf-8');
  console.log(`${file}  (${svg.length} bytes)`);
}
