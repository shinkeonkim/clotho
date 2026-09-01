import { describe, expect, test } from 'bun:test';
import { animationDocumentSchema } from '../schema';
import { autofixDocument, lintDocument, type LintRule } from './index';

const doc = animationDocumentSchema.parse({
  clothoVersion: 1,
  id: 'lint',
  assets: { unused: { kind: 'external', url: 'https://example.com/a.png' } },
  elements: [
    {
      id: 'tiny',
      type: 'text',
      x: 0,
      y: 0,
      fontSize: 10,
      content: 'a'.repeat(200),
      translations: { en: '' },
      tracks: [
        {
          property: 'x',
          keyframes: [
            { time: 500, value: 5 },
            { time: 0, value: 0 },
          ],
        },
      ],
    },
  ],
});

describe('Clotho linter와 autofix', () => {
  test('preset별 품질 finding과 안전한 fix 여부를 제공한다', () => {
    const issues = lintDocument(doc);
    expect(issues.map(({ ruleId }) => ruleId)).toEqual(
      expect.arrayContaining([
        'asset/no-unused',
        'timeline/sort-keyframes',
        'i18n/no-empty-translation',
        'text/overflow',
        'text/minimum-size',
      ]),
    );
  });
  test('asset, translation과 keyframe만 의미 변화 없이 고친다', () => {
    const result = autofixDocument(doc);
    expect(result.document.assets).toEqual({});
    expect(result.document.elements[0]?.tracks[0]?.keyframes.map(({ time }) => time)).toEqual([
      0, 500,
    ]);
    expect(result.fixes).toHaveLength(3);
    expect(result.remaining.map(({ ruleId }) => ruleId)).toEqual(
      expect.arrayContaining(['text/overflow', 'text/minimum-size']),
    );
  });
  test('조직별 rule과 disabled rule을 확장한다', () => {
    const rule: LintRule = {
      id: 'team/title',
      preset: 'recommended',
      run: () => [
        {
          ruleId: 'team/title',
          preset: 'recommended',
          severity: 'warning',
          path: 'title',
          message: 'title required',
          fixable: false,
        },
      ],
    };
    expect(
      lintDocument(doc, { rules: [rule], disabledRules: ['text/overflow'] }).map(
        ({ ruleId }) => ruleId,
      ),
    ).toContain('team/title');
    expect(
      lintDocument(doc, { disabledRules: ['text/overflow'] }).map(({ ruleId }) => ruleId),
    ).not.toContain('text/overflow');
  });
});
