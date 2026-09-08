// Custom element tests, against happy-dom.
//
// The element is a thin wrapper, so what is worth testing is the lifecycle around
// it: what happens on a bad document, on a document that arrives late, and on an
// element removed from the page while it is still playing.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Window } from 'happy-dom';
import { defineClothoPlayer, type ClothoPlayer } from '../src/element';

const ALWAYS = [{ start: 0, end: 1000, entryDuration: 0, exitDuration: 0 }];

const raw = (over: Record<string, unknown> = {}) => ({
  clothoVersion: 1,
  id: 'demo',
  title: 'Demo',
  duration: 1000,
  canvas: { width: 200, height: 100 },
  chapters: [
    { id: 'a', time: 0, label: 'A' },
    { id: 'b', time: 500, label: 'B' },
  ],
  elements: [{ type: 'rect', id: 'r', x: 0, y: 0, width: 20, height: 20, appearances: ALWAYS }],
  ...over,
});

let window: Window;

/** Wait for the element's async load to settle. */
const settle = () => new Promise((done) => setTimeout(done, 0));

beforeEach(() => {
  window = new Window({ url: 'https://example.com' });
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = window;
  g.document = window.document;
  g.Element = window.Element;
  g.HTMLElement = window.HTMLElement;
  g.Node = window.Node;
  g.SVGElement = window.SVGElement;
  g.ShadowRoot = window.ShadowRoot;
  g.CustomEvent = window.CustomEvent;
  g.customElements = window.customElements;
  g.CSSStyleSheet = undefined;
  g.IntersectionObserver = undefined;
  g.matchMedia = undefined;
  defineClothoPlayer();
});

afterEach(async () => {
  // Disconnect first: an element left in the tree keeps a player, and its next frame
  // would fire against a window this test has already thrown away — which surfaces
  // as an unrelated test file failing.
  window.document.body.innerHTML = '';
  await (window as unknown as { happyDOM?: { close(): Promise<void> } }).happyDOM?.close();

  const g = globalThis as unknown as Record<string, unknown>;
  for (const key of [
    'window',
    'document',
    'Element',
    'HTMLElement',
    'Node',
    'SVGElement',
    'ShadowRoot',
    'CustomEvent',
    'customElements',
    'fetch',
  ]) {
    delete g[key];
  }
});

function mount(html: string): HTMLElement {
  window.document.body.innerHTML = html;
  return window.document.querySelector('clotho-player') as unknown as HTMLElement;
}

const shadowHtml = (element: HTMLElement): string =>
  (element as unknown as { shadowRoot: { innerHTML: string } }).shadowRoot.innerHTML;

describe('registration', () => {
  it('registers the element', () => {
    expect(window.customElements.get('clotho-player')).toBeDefined();
  });

  it('can be called twice without throwing', () => {
    expect(() => {
      defineClothoPlayer();
      defineClothoPlayer();
    }).not.toThrow();
  });

  it('accepts a different tag for a page that already owns the default', () => {
    defineClothoPlayer('my-player');
    expect(window.customElements.get('my-player')).toBeDefined();
  });
});

describe('an inline document', () => {
  const inline = (over: Record<string, unknown> = {}) =>
    mount(
      `<clotho-player><script type="application/json">${JSON.stringify(raw(over))}</script></clotho-player>`,
    );

  it('mounts a player without a network request', async () => {
    const element = inline();
    await settle();
    expect(shadowHtml(element)).toContain('svg');
    expect(element.hasAttribute('data-clotho-error')).toBe(false);
  });

  it('carries its own stylesheet, since a shadow root cannot see the page', async () => {
    const element = inline();
    await settle();
    expect(shadowHtml(element)).toContain('cloth-wrapper');
    expect(shadowHtml(element)).toContain('<style');
  });

  it('exposes the player so a page can drive it', async () => {
    const element = inline();
    await settle();
    const player = (element as unknown as ClothoPlayer).player!;
    expect(player).not.toBeNull();
    player.seek(400);
    expect(player.getState().time).toBe(400);
  });

  it('announces itself when it is ready', async () => {
    window.document.body.innerHTML = '';
    const seen: string[] = [];
    window.document.addEventListener('clotho-ready', (event) => {
      seen.push((event as unknown as CustomEvent).detail.id);
    });
    inline();
    await settle();
    expect(seen).toEqual(['demo']);
  });

  it('reports a chapter change once per crossing', async () => {
    const element = inline();
    await settle();
    const changes: number[] = [];
    element.addEventListener('clotho-chapterchange', (event) => {
      changes.push((event as unknown as CustomEvent).detail.index);
    });
    const player = (element as unknown as ClothoPlayer).player!;
    player.seek(600);
    player.seek(700);
    expect(changes).toEqual([1]);
  });
});

describe('failures', () => {
  it('says so, visibly, for a document that does not parse', async () => {
    const element = mount(
      '<clotho-player><script type="application/json">{"clothoVersion":1}</script></clotho-player>',
    );
    await settle();
    expect(element.getAttribute('data-clotho-error')).toContain('invalid document');
    // Visible text rather than an empty box: an embed that occupies no space is the
    // hardest kind of breakage to notice on someone else's page.
    expect(shadowHtml(element)).toContain('clotho:');
  });

  it('says so when there is no document at all', async () => {
    const element = mount('<clotho-player></clotho-player>');
    await settle();
    expect(element.getAttribute('data-clotho-error')).toContain('no document');
  });

  it('reports a failed fetch rather than staying blank', async () => {
    (globalThis as unknown as Record<string, unknown>).fetch = async () =>
      ({ ok: false, status: 404, statusText: 'Not Found' }) as Response;
    const element = mount('<clotho-player src="/missing.json"></clotho-player>');
    await settle();
    await settle();
    expect(element.getAttribute('data-clotho-error')).toContain('404');
  });

  it('emits an error event a page can act on', async () => {
    const messages: string[] = [];
    window.document.addEventListener('clotho-error', (event) => {
      messages.push((event as unknown as CustomEvent).detail.message);
    });
    mount('<clotho-player></clotho-player>');
    await settle();
    expect(messages).toHaveLength(1);
  });
});

describe('src', () => {
  it('fetches and mounts', async () => {
    (globalThis as unknown as Record<string, unknown>).fetch = async () =>
      ({ ok: true, json: async () => raw() }) as unknown as Response;
    const element = mount('<clotho-player src="/a.json"></clotho-player>');
    await settle();
    await settle();
    expect(shadowHtml(element)).toContain('svg');
  });

  /**
   * A slow first response must not overwrite a fast second one. Without the
   * generation check the element would end up showing whichever document the network
   * happened to deliver last.
   */
  it('ignores a stale response when src changes mid-flight', async () => {
    const responses: Record<string, unknown> = {
      '/slow.json': raw({ id: 'slow', title: 'Slow' }),
      '/fast.json': raw({ id: 'fast', title: 'Fast' }),
    };
    (globalThis as unknown as Record<string, unknown>).fetch = async (url: string) => {
      if (url === '/slow.json') await new Promise((done) => setTimeout(done, 30));
      return { ok: true, json: async () => responses[url] } as unknown as Response;
    };

    const element = mount('<clotho-player src="/slow.json"></clotho-player>');
    element.setAttribute('src', '/fast.json');
    await new Promise((done) => setTimeout(done, 60));

    expect(shadowHtml(element)).toContain('Fast');
    expect(shadowHtml(element)).not.toContain('Slow');
  });
});

describe('attributes', () => {
  const inline = () =>
    mount(
      `<clotho-player speed="2"><script type="application/json">${JSON.stringify(raw())}</script></clotho-player>`,
    );

  it('applies the initial speed', async () => {
    const element = inline();
    await settle();
    expect((element as unknown as ClothoPlayer).player!.getState().speed).toBe(2);
  });

  it('changes speed in place rather than rebuilding', async () => {
    const element = inline();
    await settle();
    const before = (element as unknown as ClothoPlayer).player;
    element.setAttribute('speed', '0.5');
    expect((element as unknown as ClothoPlayer).player).toBe(before);
    expect(before!.getState().speed).toBe(0.5);
  });
});

describe('lifecycle', () => {
  it('destroys the player when the element leaves the page', async () => {
    const element = mount(
      `<clotho-player><script type="application/json">${JSON.stringify(raw())}</script></clotho-player>`,
    );
    await settle();
    const player = (element as unknown as ClothoPlayer).player!;
    let destroyed = false;
    // `destroy` drops every listener, so a subscription that stops firing is the
    // observable evidence the clock is gone.
    player.subscribe(() => {
      destroyed = false;
    });
    element.remove();
    destroyed = true;
    player.seek(100);
    expect(destroyed).toBe(true);
    expect((element as unknown as ClothoPlayer).player).toBeNull();
  });
});
