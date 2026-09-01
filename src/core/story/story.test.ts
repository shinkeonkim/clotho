import { describe, expect, test } from 'bun:test';
import { createStorySession, defineStory, storyDeepLink, validateStory } from './index';

const document = (id: string, checkpoint = false) => ({
  clothoVersion: 1,
  id,
  duration: 1000,
  elements: [],
  checkpoints: checkpoint
    ? [
        {
          id: 'answer',
          time: 500,
          prompt: '선택',
          interaction: 'choice',
          options: [{ value: 'yes', label: '예' }],
        },
      ]
    : [],
});
const story = () =>
  defineStory({
    storyVersion: 1,
    id: 'decision',
    initialNode: 'start',
    nodes: [
      { id: 'start', document: document('start', true) },
      { id: 'yes', document: document('yes') },
      { id: 'no', document: document('no') },
    ],
    edges: [
      { id: 'to-yes', from: 'start', to: 'yes', checkpointId: 'answer', equals: 'yes' },
      { id: 'to-no', from: 'start', to: 'no', checkpointId: 'answer', equals: 'no' },
    ],
  });

describe('branching story', () => {
  test('checkpoint 응답으로 node를 이동하고 방문 기록과 뒤로 가기를 관리한다', () => {
    const session = createStorySession(story());
    expect(session.answer('answer', 'yes')).toMatchObject({ nodeId: 'yes', history: ['start'] });
    expect(session.back()).toMatchObject({ nodeId: 'start', history: [] });
  });
  test('없는 node, checkpoint와 도달할 수 없는 node를 진단한다', () => {
    const manifest = story();
    const findings = validateStory({
      ...manifest,
      edges: [{ ...manifest.edges[0]!, from: 'missing', checkpointId: 'missing' }],
    });
    expect(findings.map(({ code }) => code)).toContain('missing-node');
    expect(findings.map(({ code }) => code)).toContain('unreachable-node');
  });
  test('URL query에 story와 node를 안전하게 기록한다', () => {
    expect(storyDeepLink('설명 흐름', '오답/해설')).toBe(
      'story=%EC%84%A4%EB%AA%85%20%ED%9D%90%EB%A6%84&node=%EC%98%A4%EB%8B%B5%2F%ED%95%B4%EC%84%A4',
    );
  });
});
