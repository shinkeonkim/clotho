import { describe, expect, it } from 'bun:test';
import { animationDocumentSchema } from '../schema/document';
import { buildScene } from '../scene/build';
import { validateDocument } from '../validate/validate';
import { resolveLocalizedText, textElementLocales } from '.';

const raw = {
  clothoVersion: 1 as const,
  id: 'localized-text',
  duration: 1000,
  elements: [
    {
      type: 'text' as const,
      id: 'message',
      x: 10,
      y: 20,
      content: '기본 문구',
      translations: { en: 'Default message', ja: '基本メッセージ', 'zh-CN': '默认文本' },
      locales: ['ko', 'en', 'ja', 'zh-CN'],
      appearances: [{ start: 0, end: 1000 }],
    },
  ],
};

describe('text localization', () => {
  it('keeps existing text content and supplies Korean and English as document defaults', () => {
    const animation = animationDocumentSchema.parse({
      clothoVersion: 1,
      id: 'existing',
      elements: [{ type: 'text', id: 'text', x: 0, y: 0, content: '그대로' }],
    });
    expect(animation.locales).toEqual(['ko', 'en']);
    expect(animation.elements[0]).toMatchObject({ content: '그대로', translations: {} });
  });

  it('resolves exact and base-language matches before falling back to content', () => {
    expect(resolveLocalizedText('기본', { en: 'English' }, 'en-US')).toBe('English');
    expect(resolveLocalizedText('기본', { ja: '日本語' }, 'fr')).toBe('기본');
  });

  it('renders the selected locale and supports element-level locale extensions', () => {
    const animation = animationDocumentSchema.parse(raw);
    expect(textElementLocales(animation, animation.elements[0]! as never)).toEqual([
      'ko',
      'en',
      'ja',
      'zh-CN',
    ]);
    const scene = buildScene(animation, 0, { locale: 'zh-CN' });
    expect(scene.nodes[0]).toMatchObject({ kind: 'text', content: '默认文本' });
  });

  it('warns when a translation is outside the effective language list', () => {
    const result = validateDocument({
      ...raw,
      elements: [{ ...raw.elements[0], locales: ['ko', 'en'] }],
    });
    expect(result.findings.some((finding) => finding.code === 'unlisted-translation-locale')).toBe(
      true,
    );
  });
});
