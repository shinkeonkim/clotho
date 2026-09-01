import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { GALLERY } from '../examples/gallery/documents';
import { animationDocumentSchema } from '../src/core/schema';
import { renderDocumentToSvg } from '../src/svg';

const baselinePath = 'tests/visual-baseline.json';
const artifactPath = 'artifacts/visual-regression.json';
const update = process.argv.includes('--update');
const hashes: Record<string, string> = {};
for (const entry of GALLERY) {
  const document = animationDocumentSchema.parse(entry.doc);
  for (const width of [375, 768, 1280])
    for (const time of [0, Math.round(document.duration / 2), document.duration]) {
      const svg = renderDocumentToSvg(document, time, {
        standalone: true,
        viewportWidth: width,
        assetResolver: entry.assetResolver,
      });
      hashes[`${entry.slug}/${width}/${time}`] = createHash('sha256').update(svg).digest('hex');
    }
}
if (update) {
  writeFileSync(baselinePath, `${JSON.stringify(hashes, null, 2)}\n`);
  console.log(`updated ${baselinePath} with ${Object.keys(hashes).length} frames`);
  process.exit(0);
}
const expected = JSON.parse(readFileSync(baselinePath, 'utf8')) as Record<string, string>;
const changed = Object.keys({ ...expected, ...hashes }).filter(
  (key) => expected[key] !== hashes[key],
);
mkdirSync('artifacts', { recursive: true });
writeFileSync(artifactPath, `${JSON.stringify({ changed, expected, actual: hashes }, null, 2)}\n`);
if (changed.length > 0) {
  console.error(`visual baseline changed in ${changed.length} frame(s):\n${changed.join('\n')}`);
  process.exit(1);
}
console.log(`visual baseline OK — ${Object.keys(hashes).length} responsive frames match`);
