import { describe, expect, test } from 'bun:test';
import { defineTemplate, instantiateTemplateReference, TemplateParameterError } from './template';

const searchTemplate = defineTemplate<{
  values: number[];
  target: number;
  color: string;
  showIndex: boolean;
}>({
  id: 'dev.clotho.search',
  parameters: {
    values: { type: 'array', items: { type: 'number', integer: true }, minItems: 1 },
    target: { type: 'number', integer: true },
    color: { type: 'enum', values: ['indigo', 'green'], default: 'indigo' },
    showIndex: { type: 'boolean', default: true },
  },
  build: ({ values, target, color, showIndex }) => ({
    clothoVersion: 1,
    id: 'search-result',
    title: `Find ${target}`,
    duration: values.length * 500,
    elements: values.map((value, index) => ({
      type: 'rect',
      id: `cell-${index}`,
      x: index * 60,
      y: 20,
      width: 50,
      height: 50,
      label: showIndex ? `${index}: ${value}` : String(value),
      fill: color === 'green' ? '#dcfce7' : '#e0e7ff',
    })),
  }),
});

describe('animation templates', () => {
  test('defaults와 입력값으로 standalone Clotho 문서를 만든다', () => {
    const result = searchTemplate.instantiate({ values: [3, 8], target: 8 });
    expect(result.title).toBe('Find 8');
    expect(result.elements[0]).toMatchObject({ label: '0: 3', fill: '#e0e7ff' });
  });

  test('중첩 array constraint와 알 수 없는 parameter를 한 번에 보고한다', () => {
    try {
      searchTemplate.instantiate({ values: [1.5], target: 1, extra: true } as never);
      throw new Error('expected parameter validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(TemplateParameterError);
      expect((error as TemplateParameterError).issues.map(({ path }) => path)).toEqual([
        'extra',
        'values.0',
      ]);
    }
  });

  test('참조형 JSON을 registry에서 같은 standalone 문서로 펼친다', () => {
    const reference = searchTemplate.reference({ values: [2, 4, 6], target: 4 });
    expect(reference).toEqual({
      clothoTemplate: 1,
      templateId: 'dev.clotho.search',
      parameters: { values: [2, 4, 6], target: 4, color: 'indigo', showIndex: true },
    });
    expect(
      instantiateTemplateReference(reference, new Map([[searchTemplate.id, searchTemplate]])),
    ).toEqual(searchTemplate.instantiate(reference.parameters));
  });
});
