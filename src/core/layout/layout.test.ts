import { describe, expect, test } from 'bun:test';
import { animationDocumentSchema } from '../schema/document';
import { compileLayouts } from './index';

function documentWith(layout: Record<string, unknown>, elements: Record<string, unknown>[]) {
  return animationDocumentSchema.parse({
    clothoVersion: 1,
    id: 'layout-test',
    elements,
    layouts: [{ id: 'main', ...layout }],
  });
}

describe('constraint layout compile', () => {
  test('row layout을 절대 좌표로 고정하고 입력 문서를 바꾸지 않는다', () => {
    const input = documentWith(
      { mode: 'row', elementIds: ['a', 'b'], x: 20, y: 30, gap: 12, align: 'center' },
      [
        { type: 'rect', id: 'a', x: 0, y: 0, width: 40, height: 20 },
        { type: 'rect', id: 'b', x: 0, y: 0, width: 10, height: 10 },
      ],
    );
    const result = compileLayouts(input);
    expect(result.document.elements[0]).toMatchObject({ x: 20, y: 30 });
    expect(result.document.elements[1]).toMatchObject({ x: 72, y: 35 });
    expect(input.elements[0]).toMatchObject({ x: 0, y: 0 });
  });

  test('grid는 열과 행에서 가장 큰 요소를 기준으로 배치한다', () => {
    const input = documentWith(
      {
        mode: 'grid',
        elementIds: ['a', 'b', 'c'],
        columns: 2,
        x: 10,
        y: 10,
        columnGap: 5,
        rowGap: 7,
      },
      [
        { type: 'rect', id: 'a', x: 0, y: 0, width: 30, height: 20 },
        { type: 'rect', id: 'b', x: 0, y: 0, width: 10, height: 40 },
        { type: 'rect', id: 'c', x: 0, y: 0, width: 20, height: 10 },
      ],
    );
    const result = compileLayouts(input);
    expect(result.document.elements[1]).toMatchObject({ x: 45, y: 10 });
    expect(result.document.elements[2]).toMatchObject({ x: 10, y: 57 });
  });

  test('text measurer 결과를 사용한 뒤 관계 constraint를 적용한다', () => {
    const input = documentWith(
      {
        mode: 'column',
        elementIds: ['label', 'box'],
        constraints: [{ type: 'rightOf', elementId: 'box', targetId: 'label', gap: 8 }],
      },
      [
        { type: 'text', id: 'label', x: 0, y: 0, content: '긴 문장', fontSize: 20 },
        { type: 'rect', id: 'box', x: 0, y: 0, width: 30, height: 20 },
      ],
    );
    const result = compileLayouts(input, { textMeasurer: { measure: () => 100 } });
    expect(result.boxes.label?.width).toBe(100);
    expect(result.boxes.box?.x).toBe(108);
  });

  test('중복 layout 소속과 찾을 수 없는 요소를 finding으로 돌려준다', () => {
    const input = animationDocumentSchema.parse({
      clothoVersion: 1,
      id: 'invalid-layout-relations',
      elements: [{ type: 'rect', id: 'a', x: 0, y: 0, width: 10, height: 10 }],
      layouts: [
        { id: 'first', mode: 'row', elementIds: ['a'] },
        { id: 'second', mode: 'row', elementIds: ['a', 'missing'] },
      ],
    });
    const result = compileLayouts(input);
    expect(result.findings.map(({ code }) => code)).toEqual([
      'duplicate-membership',
      'missing-element',
    ]);
  });
});
