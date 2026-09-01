import { describe, expect, test } from 'bun:test';
import { animationDocumentSchema } from '../schema';
import { compileResponsiveStage, selectResponsiveVariant } from './index';

const doc = animationDocumentSchema.parse({
  clothoVersion: 1,
  id: 'responsive',
  canvas: { width: 800, height: 500 },
  elements: [{ id: 'label', type: 'text', x: 10, y: 20, content: 'hello', fontSize: 16 }],
  responsive: [
    {
      id: 'compact',
      maxWidth: 479,
      canvas: { width: 375, height: 600 },
      chapterListPosition: 'bottom',
      elementOverrides: { label: { x: 30, fontSize: 24 } },
    },
    { id: 'regular', minWidth: 480 },
  ],
});

describe('responsive stage', () => {
  test('container width에 맞는 가장 구체적인 variant를 선택한다', () => {
    expect(selectResponsiveVariant(doc, 320)?.id).toBe('compact');
    expect(selectResponsiveVariant(doc, 800)?.id).toBe('regular');
  });
  test('canvas, chapter 위치와 element override를 compile한다', () => {
    const compact = compileResponsiveStage(doc, 320);
    expect(compact.canvas).toMatchObject({ width: 375, height: 600 });
    expect(compact.settings.chapterListPosition).toBe('bottom');
    expect(compact.elements[0]).toMatchObject({ x: 30, fontSize: 24 });
    expect(doc.canvas.width).toBe(800);
  });
});
