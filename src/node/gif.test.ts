import { describe, expect, it } from 'bun:test';
import { animationDocumentSchema } from '../core/schema/document';
import { renderDocumentToGif } from './gif';

const doc = animationDocumentSchema.parse({
  clothoVersion: 1,
  id: 'gif-test',
  duration: 100,
  canvas: { width: 80, height: 40 },
  elements: [
    {
      type: 'circle',
      id: 'dot',
      cx: 20,
      cy: 20,
      r: 8,
      fill: '#6366f1',
      appearances: [{ start: 0, end: 100 }],
      tracks: [{ property: 'cx', keyframes: [{ time: 0, value: 20 }, { time: 100, value: 60 }] }],
    },
  ],
});

describe('GIF export', () => {
  it('renders an animated GIF byte stream', () => {
    const bytes = renderDocumentToGif(doc, { fps: 10, width: 80 });
    expect(new TextDecoder().decode(bytes.slice(0, 6))).toBe('GIF89a');
    expect(bytes.length).toBeGreaterThan(100);
  });

  it('rejects invalid frame rates', () => {
    expect(() => renderDocumentToGif(doc, { fps: 0 })).toThrow('fps must be greater than zero');
  });
});
