import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  version: string;
  private?: boolean;
  files?: string[];
  publishConfig?: { access?: string };
  bin?: Record<string, string>;
};

if (pkg.private) throw new Error('package must not be private');
if (pkg.version === '0.0.0') throw new Error('set a release version before publishing');
if (pkg.publishConfig?.access !== 'public') throw new Error('scoped package must publish publicly');
if (pkg.bin?.clotho !== 'dist/cli/index.js') throw new Error('clotho CLI bin entry is missing');

const output = Bun.spawnSync(['bun', 'pm', 'pack', '--dry-run'], {
  cwd: root,
  stdout: 'pipe',
  stderr: 'pipe',
});
if (output.exitCode !== 0) throw new Error(output.stderr.toString());
const listing = output.stdout.toString();
for (const required of [
  'dist/core/index.js',
  'dist/react/index.js',
  'dist/vue/index.js',
  'dist/dom/index.js',
  'schema/clotho-1.schema.json',
]) {
  if (!listing.includes(required)) throw new Error(`packed artifact is missing ${required}`);
}

console.log(`release check OK — @kokoa/clotho@${pkg.version} is publishable`);
