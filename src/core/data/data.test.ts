import { describe, expect, test } from 'bun:test';
import { animationDocumentSchema } from '../schema';
import { compileDataBindings, formatBindingValue, resolveJsonPointer } from './index';

describe('declarative data binding', () => {
  test('RFC 6901 pointer의 escape와 array index를 해석한다', () => {
    expect(resolveJsonPointer({ 'a/b': [{ '~key': 7 }] }, '/a~1b/0/~0key')).toBe(7);
  });
  test('고정 data snapshot을 element property로 compile한다', () => {
    const doc = animationDocumentSchema.parse({
      clothoVersion: 1,
      id: 'binding',
      data: { queue: { size: 3, active: false }, ratio: 0.375 },
      elements: [
        {
          type: 'text',
          id: 'label',
          x: 10,
          y: 10,
          content: '',
          bindings: [{ property: 'content', pointer: '/queue/size', formatter: 'string' }],
        },
        {
          type: 'rect',
          id: 'box',
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          appearances: [{ start: 0, end: 5000 }],
          bindings: [{ property: 'visible', pointer: '/queue/active' }],
        },
      ],
    });
    const result = compileDataBindings(doc);
    expect(result.document.elements[0]).toMatchObject({ content: '3' });
    expect(result.document.elements[1]?.appearances).toEqual([]);
    expect(result.findings).toEqual([]);
  });
  test('formatter는 결정적인 text와 number만 만든다', () => {
    expect(
      formatBindingValue(0.375, { property: 'x', pointer: '', formatter: 'percent', digits: 1 }),
    ).toBe('37.5%');
  });
  test('property 타입과 맞지 않는 값은 element를 변경하지 않는다', () => {
    const doc = animationDocumentSchema.parse({
      clothoVersion: 1,
      id: 'safe-binding',
      data: { value: 'not-a-number' },
      elements: [
        {
          id: 'box',
          type: 'rect',
          x: 10,
          y: 10,
          width: 40,
          height: 20,
          bindings: [{ property: 'width', pointer: '/value' }],
        },
      ],
    });
    const result = compileDataBindings(doc);
    expect(result.document.elements[0]).toMatchObject({ width: 40 });
    expect(result.findings[0]?.message).toContain('number property type');
  });
  test('visible binding은 string을 boolean으로 강제 변환하지 않는다', () => {
    const doc = animationDocumentSchema.parse({
      clothoVersion: 1,
      id: 'visible-binding',
      data: { visible: 'false' },
      elements: [
        {
          id: 'box',
          type: 'rect',
          x: 10,
          y: 10,
          width: 40,
          height: 20,
          appearances: [{ start: 0, end: 1000 }],
          bindings: [{ property: 'visible', pointer: '/visible' }],
        },
      ],
    });
    const result = compileDataBindings(doc);
    expect(result.document.elements[0]?.appearances).toHaveLength(1);
    expect(result.findings[0]?.message).toContain('boolean');
  });
});
