// Source extraction tests.
//
// Region markers are the interesting half: they are what makes a link survive an
// edit above it, and every way they can be malformed has to produce a reason rather
// than a wrong snippet.

import { describe, expect, it } from 'bun:test';
import type { CodeSource } from '../schema/source';
import { codeSourceSchema } from '../schema/source';
import { dedent, extractSource, hashContent, isStale } from './index';

const FILE = [
  'import { z } from "zod";',
  '',
  'export function outer() {',
  '  // #region compute',
  '  const a = 1;',
  '  const b = 2;',
  '  return a + b;',
  '  // #endregion',
  '}',
  '',
  '// #region other',
  'const x = 9;',
  '// #endregion',
].join('\n');

const source = (over: Partial<CodeSource>): CodeSource =>
  ({ file: 'src/example.ts', ...over }) as CodeSource;

describe('dedent', () => {
  it('removes the shared indentation', () => {
    expect(dedent(['    a', '      b'])).toEqual(['a', '  b']);
  });

  it('ignores blank lines when measuring', () => {
    expect(dedent(['  a', '', '  b'])).toEqual(['a', '', 'b']);
  });

  it('does nothing when a line is already flush left', () => {
    expect(dedent(['a', '    b'])).toEqual(['a', '    b']);
  });
});

describe('extractSource by region', () => {
  it('takes the body between the markers, dedented', () => {
    const result = extractSource(FILE, source({ region: 'compute' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toBe('const a = 1;\nconst b = 2;\nreturn a + b;');
    expect(result.from).toBe(5);
    expect(result.to).toBe(7);
  });

  it('finds a region anywhere in the file', () => {
    const result = extractSource(FILE, source({ region: 'other' }));
    expect(result.ok && result.text).toBe('const x = 9;');
  });

  it('survives an edit above it, which line numbers would not', () => {
    const shifted = `// a new line\n// and another\n${FILE}`;
    const before = extractSource(FILE, source({ region: 'compute' }));
    const after = extractSource(shifted, source({ region: 'compute' }));
    expect(before.ok && after.ok && before.text === after.text).toBe(true);
  });

  it('is not closed early by a nested region', () => {
    const nested = [
      '// #region outer',
      'const a = 1;',
      '// #region inner',
      'const b = 2;',
      '// #endregion',
      'const c = 3;',
      '// #endregion',
    ].join('\n');
    const result = extractSource(nested, source({ region: 'outer' }));
    expect(result.ok && result.text).toContain('const c = 3;');
  });

  it.each([
    ['#', '# #region py\nvalue = 1\n# #endregion'],
    ['--', '-- #region sql\nselect 1;\n-- #endregion'],
    ['/*', '/* #region css */\n.a { color: red }\n/* #endregion */'],
  ])('accepts a %s comment leader', (_leader, text) => {
    const name = /#region (\w+)/.exec(text)![1]!;
    expect(extractSource(text, source({ region: name })).ok).toBe(true);
  });

  it('reports a region that is not there', () => {
    const result = extractSource(FILE, source({ region: 'nope' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('missing-region');
  });

  it('reports a region with no end', () => {
    const result = extractSource('// #region open\nconst a = 1;', source({ region: 'open' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unterminated-region');
  });

  it('reports a region declared twice, rather than guessing which', () => {
    const twice = '// #region dup\na\n// #endregion\n// #region dup\nb\n// #endregion';
    const result = extractSource(twice, source({ region: 'dup' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('duplicate-region');
  });

  it('reports an empty region', () => {
    const result = extractSource('// #region blank\n\n// #endregion', source({ region: 'blank' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('empty-region');
  });
});

describe('extractSource by lines', () => {
  it('takes an inclusive 1-based span', () => {
    const result = extractSource(FILE, source({ lines: [1, 1] }));
    expect(result.ok && result.text).toBe('import { z } from "zod";');
  });

  it('dedents the span', () => {
    const result = extractSource(FILE, source({ lines: [5, 7] }));
    expect(result.ok && result.text).toBe('const a = 1;\nconst b = 2;\nreturn a + b;');
  });

  it('reports a span past the end of the file', () => {
    const result = extractSource(FILE, source({ lines: [1, 900] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('lines-out-of-range');
  });

  it('reports a reversed span', () => {
    const result = extractSource(FILE, source({ lines: [9, 3] }));
    expect(result.ok).toBe(false);
  });

  it('reports a source with neither selector', () => {
    const result = extractSource(FILE, source({}));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no-selector');
  });
});

describe('schema', () => {
  it('refuses both selectors at once, which would be ambiguous', () => {
    const both = codeSourceSchema.safeParse({
      file: 'a.ts',
      region: 'x',
      lines: [1, 2],
    });
    expect(both.success).toBe(false);
  });

  it('accepts either selector alone', () => {
    expect(codeSourceSchema.safeParse({ file: 'a.ts', region: 'x' }).success).toBe(true);
    expect(codeSourceSchema.safeParse({ file: 'a.ts', lines: [1, 2] }).success).toBe(true);
  });

  it('refuses a region name that could not appear in a marker', () => {
    expect(codeSourceSchema.safeParse({ file: 'a.ts', region: 'a b' }).success).toBe(false);
  });
});

describe('hashContent', () => {
  it('is stable and prefixed', async () => {
    const hash = await hashContent('const a = 1;');
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(await hashContent('const a = 1;')).toBe(hash);
  });

  it('changes with the content', async () => {
    expect(await hashContent('a')).not.toBe(await hashContent('b'));
  });

  it('ignores line-ending style, so a document is not stale across platforms', async () => {
    expect(await hashContent('a\r\nb')).toBe(await hashContent('a\nb'));
  });

  it('notices whitespace that is not a line ending', async () => {
    expect(await hashContent('a b')).not.toBe(await hashContent('a  b'));
  });
});

describe('isStale', () => {
  it('is false without a recorded hash — nothing has been claimed yet', async () => {
    expect(await isStale('anything', source({ region: 'x' }))).toBe(false);
  });

  it('is false when the content still matches', async () => {
    const content = 'const a = 1;';
    const hash = await hashContent(content);
    expect(await isStale(content, source({ region: 'x', hash }))).toBe(false);
  });

  it('is true once the content has moved on', async () => {
    const hash = await hashContent('const a = 1;');
    expect(await isStale('const a = 2;', source({ region: 'x', hash }))).toBe(true);
  });
});
