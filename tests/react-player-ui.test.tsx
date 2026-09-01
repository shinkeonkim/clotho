import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { animationDocumentSchema } from '../src/core/schema/document';
import { AnimationPlayer } from '../src/react/AnimationPlayer';

const doc = animationDocumentSchema.parse({
  clothoVersion: 1,
  id: 'player-ui',
  title: 'Player UI',
  duration: 1200,
  settings: { autoplay: false, loop: false, showCaption: false, showChapterList: false },
  elements: [],
});

describe('React player controls', () => {
  it('renders the enlarge action and a draggable timeline', () => {
    const html = renderToStaticMarkup(<AnimationPlayer doc={doc} />);
    expect(html).toContain('aria-label="Enlarge"');
    expect(html).toContain('class="cloth-wrapper-timeline"');
    expect(html).toContain('aria-label="Animation timeline"');
    expect(html).toContain('max="1200"');
  });

  it('pins an explicit light palette on the player root', () => {
    const html = renderToStaticMarkup(<AnimationPlayer doc={doc} theme="light" />);
    expect(html).toContain('data-cloth-theme="light"');
  });

  it('renders a checkpoint interaction at the current time', () => {
    const interactive = animationDocumentSchema.parse({
      clothoVersion: 1,
      id: 'react-checkpoint',
      duration: 1000,
      checkpoints: [
        {
          id: 'ready',
          time: 0,
          prompt: '계속할까요?',
          interaction: 'continue',
        },
      ],
    });
    const html = renderToStaticMarkup(<AnimationPlayer doc={interactive} />);
    expect(html).toContain('class="cloth-checkpoint"');
    expect(html).toContain('계속할까요?');
    expect(html).toContain('Continue');
  });

  it('exposes checkpoint choices as accessible toggle buttons', () => {
    const interactive = animationDocumentSchema.parse({
      clothoVersion: 1,
      id: 'react-choice',
      duration: 1000,
      checkpoints: [
        {
          id: 'recovery',
          time: 0,
          prompt: '먼저 복구할 대상은?',
          interaction: 'choice',
          options: [{ value: 'queue', label: 'Queue' }],
          required: true,
        },
      ],
    });
    const html = renderToStaticMarkup(<AnimationPlayer doc={interactive} />);
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('data-selected="false"');
    expect(html).toContain('disabled=""');
  });
});
