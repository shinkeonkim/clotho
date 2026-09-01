import { describe, expect, it } from 'bun:test';
import { createSSRApp, h } from 'vue';
import { renderToString } from '@vue/server-renderer';
import { animationDocumentSchema } from '../src/core/schema/document';
import { AnimationPlayer } from '../src/vue/components';

describe('Vue player checkpoint UI', () => {
  it('renders accessible checkpoint choices at the current time', async () => {
    const doc = animationDocumentSchema.parse({
      clothoVersion: 1,
      id: 'vue-checkpoint',
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
    const html = await renderToString(createSSRApp({ render: () => h(AnimationPlayer, { doc }) }));
    expect(html).toContain('class="cloth-checkpoint"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('data-selected="false"');
    expect(html).toContain('disabled');
  });
});
