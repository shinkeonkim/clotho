// Markdown embed tests.
//
// The build step is the half worth being strict about: a fence that does not parse
// has to stop the build, and the payload it emits has to survive being put inside a
// `<script>` in an HTML page.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Window } from 'happy-dom';
import { animationDocumentSchema } from '../core/schema/document';
import { posterTime } from '../core/poster';
import {
  embedJson,
  hydrateClothoEmbeds,
  renderEmbed,
  transformTree,
  type MarkdownNode,
} from './index';

const ALWAYS = [{ start: 0, end: 4000, entryDuration: 0, exitDuration: 0 }];

const raw = (over: Record<string, unknown> = {}) => ({
  clothoVersion: 1,
  id: 'queue',
  title: 'Queue',
  duration: 4000,
  canvas: { width: 200, height: 100 },
  elements: [{ type: 'rect', id: 'r', x: 10, y: 10, width: 40, height: 20, appearances: ALWAYS }],
  ...over,
});

const document_ = (over: Record<string, unknown> = {}) => animationDocumentSchema.parse(raw(over));

const fence = (value: unknown, meta?: string): MarkdownNode => ({
  type: 'code',
  lang: 'clotho',
  meta: meta ?? null,
  value: typeof value === 'string' ? value : JSON.stringify(value),
  position: { start: { line: 12 } },
});

const tree = (...children: MarkdownNode[]): MarkdownNode => ({ type: 'root', children });

describe('posterTime', () => {
  it('uses the first chapter after zero', () => {
    expect(
      posterTime(
        document_({
          chapters: [
            { id: 'a', time: 0, label: 'start' },
            { id: 'b', time: 1500, label: 'middle' },
          ],
        }),
      ),
    ).toBe(1500);
  });

  it('falls back to a chapter at zero when it is the only one', () => {
    expect(posterTime(document_({ chapters: [{ id: 'a', time: 0 }] }))).toBe(0);
  });

  it('uses a fraction of the duration with no chapters', () => {
    expect(posterTime(document_())).toBe(1600);
  });

  it('never points past the end', () => {
    expect(posterTime(document_({ chapters: [{ id: 'a', time: 99_000 }] }))).toBe(4000);
  });
});

describe('embedJson', () => {
  it('cannot close the script block it will sit inside', () => {
    const nasty = document_({ title: '</script><img src=x onerror=alert(1)>' });
    const payload = embedJson(nasty);
    expect(payload).not.toContain('</script>');
    expect(payload).not.toContain('<img');
    // Still valid JSON, and still the same title once parsed.
    expect(JSON.parse(payload).title).toBe('</script><img src=x onerror=alert(1)>');
  });

  it('escapes the line separators JSON allows and JavaScript does not', () => {
    const payload = embedJson(document_({ title: 'a b c' }));
    expect(payload).not.toContain(' ');
    expect(JSON.parse(payload).title).toBe('a b c');
  });
});

describe('renderEmbed', () => {
  it('carries the document and a poster frame', () => {
    const html = renderEmbed(document_());
    expect(html).toContain('class="cloth-embed"');
    expect(html).toContain('data-clotho-id="queue"');
    expect(html).toContain('script type="application/json"');
    expect(html).toContain('<svg');
  });

  it('labels the poster for a reader who cannot see it', () => {
    expect(renderEmbed(document_())).toContain('aria-label="Queue"');
  });

  it('records which instant the poster shows', () => {
    expect(renderEmbed(document_(), { poster: 2500 })).toContain('data-clotho-poster="2500"');
  });

  it('drops the poster for a document too large to inline', () => {
    const html = renderEmbed(document_(), { maxPosterNodes: 0 });
    expect(html).not.toContain('<svg');
    // The payload still travels, so hydration still works.
    expect(html).toContain('data-clotho-document');
  });
});

describe('transformTree', () => {
  it('replaces a clotho fence with an embed', () => {
    const result = transformTree(tree(fence(raw())));
    expect(result.children![0]!.type).toBe('html');
    expect(String(result.children![0]!.value)).toContain('cloth-embed');
  });

  it('leaves other fences alone', () => {
    const other: MarkdownNode = { type: 'code', lang: 'ts', value: 'const a = 1;' };
    const result = transformTree(tree(other));
    expect(result.children![0]).toBe(other);
  });

  it('reaches fences nested inside other nodes', () => {
    const result = transformTree(tree({ type: 'blockquote', children: [fence(raw())] }));
    expect(result.children![0]!.children![0]!.type).toBe('html');
  });

  it('reads a poster time from the fence info string', () => {
    const result = transformTree(tree(fence(raw(), 'poster=2500')));
    expect(String(result.children![0]!.value)).toContain('data-clotho-poster="2500"');
  });

  /** The reason to adopt this at all: a broken animation stops the build. */
  it('throws on JSON that does not parse, naming the line', () => {
    expect(() => transformTree(tree(fence('{ not json')))).toThrow(/line 12/);
  });

  it('throws on a document that does not satisfy the schema', () => {
    expect(() => transformTree(tree(fence({ clothoVersion: 1 })))).toThrow(/clotho document/);
  });

  it('degrades to a code block instead when strictness is off', () => {
    const errors: string[] = [];
    const result = transformTree(tree(fence('{ not json')), {
      strict: false,
      onError: (message) => errors.push(message),
    });
    expect(result.children![0]!.type).toBe('code');
    expect(result.children![0]!.lang).toBe('json');
    expect(errors).toHaveLength(1);
  });

  it('honours a different fence language', () => {
    const custom: MarkdownNode = { type: 'code', lang: 'anim', value: JSON.stringify(raw()) };
    expect(transformTree(tree(custom), { lang: 'anim' }).children![0]!.type).toBe('html');
  });
});

describe('hydrateClothoEmbeds', () => {
  let window: Window;

  beforeEach(() => {
    window = new Window({ url: 'https://example.com' });
    const g = globalThis as unknown as Record<string, unknown>;
    g.window = window;
    g.document = window.document;
    g.Element = window.Element;
    g.Node = window.Node;
    g.SVGElement = window.SVGElement;
    g.IntersectionObserver = undefined;
    g.matchMedia = undefined;
    window.document.body.innerHTML = renderEmbed(document_());
  });

  afterEach(() => {
    const g = globalThis as unknown as Record<string, unknown>;
    for (const key of ['window', 'document', 'Element', 'Node', 'SVGElement']) delete g[key];
  });

  it('promotes an embed to a player', async () => {
    const promoted = await hydrateClothoEmbeds({ eager: true });
    expect(promoted).toBe(1);
    expect(window.document.querySelector('.cloth-embed')!.innerHTML).toContain('svg');
    expect(window.document.querySelector('script[data-clotho-document]')).toBeNull();
  });

  it('marks what it promoted, so a second call does nothing', async () => {
    await hydrateClothoEmbeds({ eager: true });
    expect(await hydrateClothoEmbeds({ eager: true })).toBe(0);
  });

  it('does nothing on a page with no embeds', async () => {
    window.document.body.innerHTML = '<p>nothing here</p>';
    expect(await hydrateClothoEmbeds({ eager: true })).toBe(0);
  });

  it('promotes immediately when the browser cannot observe intersections', async () => {
    // No IntersectionObserver in this environment, so laziness is not available and
    // showing a static poster forever would be worse than mounting eagerly.
    expect(await hydrateClothoEmbeds()).toBe(1);
    expect(window.document.querySelector('.cloth-embed')!.innerHTML).toContain('svg');
  });
});
