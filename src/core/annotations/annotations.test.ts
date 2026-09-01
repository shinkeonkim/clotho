import { describe, expect, test } from 'bun:test';
import { annotationTokens, splitAnnotations } from './index';
import { animationDocumentSchema } from '../schema/document';
import { buildScene } from '../scene/build';
import { validateDocument } from '../validate/validate';

describe('linked annotations', () => {
  test('문구 token을 대상 요소와 연결된 부분으로 나눈다', () => {
    expect(splitAnnotations('{queue}에서 {node}로 이동', { queue: 'q', node: ['a', 'b'] })).toEqual(
      [
        { kind: 'reference', value: 'queue', token: 'queue', targetIds: ['q'] },
        { kind: 'text', value: '에서 ' },
        { kind: 'reference', value: 'node', token: 'node', targetIds: ['a', 'b'] },
        { kind: 'text', value: '로 이동' },
      ],
    );
    expect(annotationTokens('{queue}와 {queue}')).toEqual(['queue', 'queue']);
  });

  test('scene에 keyboard 접근 가능한 reference와 target metadata를 남긴다', () => {
    const document = animationDocumentSchema.parse({
      clothoVersion: 1,
      id: 'annotation-scene',
      duration: 1000,
      elements: [
        {
          type: 'rect',
          id: 'queue',
          x: 20,
          y: 20,
          width: 80,
          height: 40,
          appearances: [{ start: 0, end: 1000 }],
        },
        {
          type: 'text',
          id: 'caption',
          x: 20,
          y: 100,
          content: '{queue}에 삽입',
          references: { queue: 'queue' },
          appearances: [{ start: 0, end: 1000 }],
        },
      ],
    });
    const scene = buildScene(document, 500);
    expect(scene.nodes[0]?.attrs['data-clotho-id']).toBe('queue');
    const text = scene.nodes[1];
    expect(text?.kind).toBe('text');
    if (text?.kind === 'text')
      expect(text.spans?.[0]?.attrs).toMatchObject({
        'data-clotho-ref': 'queue',
        tabindex: 0,
        role: 'link',
      });
  });

  test('번역 token 차이와 없는 대상 요소를 오류로 보고한다', () => {
    const result = validateDocument({
      clothoVersion: 1,
      id: 'annotation-errors',
      elements: [
        {
          type: 'text',
          id: 'caption',
          x: 0,
          y: 0,
          content: '{node}',
          translations: { en: 'node' },
          references: { node: 'missing' },
        },
      ],
    });
    expect(result.findings.map(({ code }) => code)).toContain('annotation-token-mismatch');
    expect(result.findings.map(({ code }) => code)).toContain('unknown-reference');
  });
});
