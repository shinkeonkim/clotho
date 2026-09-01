import { describe, expect, test } from 'bun:test';
import { animationDocumentSchema } from '../schema/document';
import { createManualScheduler } from '../player/scheduler';
import { createPlayer } from '../player/create-player';
import { createInteractionSession } from './session';

describe('interactive checkpoints', () => {
  test('도달한 checkpoint에서 멈추고 응답을 document 밖 session에 기록한다', () => {
    const doc = animationDocumentSchema.parse({
      clothoVersion: 1,
      id: 'quiz',
      duration: 1000,
      checkpoints: [
        {
          id: 'predict',
          time: 100,
          prompt: 'next?',
          interaction: 'choice',
          options: [{ value: 'b', label: 'B' }],
          predicate: { type: 'equals', value: 'b' },
        },
      ],
    });
    const scheduler = createManualScheduler();
    const player = createPlayer(doc, { scheduler });
    const session = createInteractionSession(doc, player);
    player.play();
    scheduler.advance(0);
    scheduler.advance(64);
    scheduler.advance(128);
    expect(player.getState()).toMatchObject({ time: 100, playing: false });
    expect(session.getState().pending?.id).toBe('predict');
    expect(session.answer('b').correct).toBe(true);
    expect(doc).not.toHaveProperty('answers');
    session.continue();
    scheduler.advance(200);
    scheduler.advance(250);
    expect(player.getState().time).toBeGreaterThan(100);
  });
});
