// Putting an animation in a markdown document.
//
// Every consumer was writing the same twenty lines: fetch the JSON, parse it, handle
// the failure, keep it off the server render, stop it playing off screen. Three
// things fell out of that. A broken document was discovered after deploy rather than
// during the build. The first paint needed JavaScript, so one animation delayed the
// whole article. And a reader with JS off — or an RSS reader, or a crawler — got
// nothing at all.
//
// Two pieces solve it: a build step that validates and inlines a poster frame, and a
// hydration call that promotes those posters to players when they scroll into view.
//
// The build step emits **HTML**, not a framework component. Astro, Next, Docusaurus,
// Vitepress and plain markdown then all take the same path, and this package takes
// no dependency on unified — a remark plugin is a function from a tree to a tree,
// and the tree can be described structurally.

import { parseDocument } from '../core/schema';
import type { AnimationDocument } from '../core/schema/document';
import { posterTime } from '../core/poster';
import { renderDocumentToSvg } from '../svg/render';
import { escapeXmlAttr } from '../core/text/escape';
import { CLASS } from '../dom/strings';

/** The bits of an mdast node this plugin needs. Structural, so unified stays out. */
export interface MarkdownNode {
  type: string;
  lang?: string | null;
  meta?: string | null;
  value?: string;
  children?: MarkdownNode[];
  position?: { start?: { line?: number; column?: number } };
  [key: string]: unknown;
}

export interface RemarkClothoOptions {
  /**
   * Fence language to transform. `clotho` by default.
   */
  readonly lang?: string;
  /**
   * Fail the build on a document that does not parse.
   *
   * On by default, and it is most of the point: a broken animation should stop a
   * deploy, not become an empty rectangle someone notices in a month. Turning it off
   * leaves the fence as ordinary code and records the reason.
   */
  readonly strict?: boolean;
  /**
   * Skip the inline poster above this many scene nodes.
   *
   * An inlined SVG is bytes in the HTML, and past a certain size it costs the page
   * more than the no-JavaScript first paint gains it.
   */
  readonly maxPosterNodes?: number;
  /** Called for each failure when `strict` is off. */
  readonly onError?: (message: string, node: MarkdownNode) => void;
}

const DEFAULT_MAX_POSTER_NODES = 300;

/**
 * Serialize a document for a `<script type="application/json">` block.
 *
 * `</script>` inside a string would end the block early and spill the rest of the
 * document into the page as markup — the classic JSON-in-HTML hole. Escaping the
 * `<` keeps it valid JSON while making the sequence unrecognizable to the parser.
 */
export function embedJson(document: AnimationDocument): string {
  return (
    JSON.stringify(document)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      // U+2028 and U+2029 terminate a line for a JavaScript parser but not for JSON,
      // so an unescaped one turns a valid payload into a syntax error.
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029')
  );
}

export interface EmbedOptions {
  readonly poster?: number;
  readonly maxPosterNodes?: number;
}

/** The HTML for one embedded document: the payload, and a poster to look at. */
export function renderEmbed(document: AnimationDocument, options: EmbedOptions = {}): string {
  const at = options.poster ?? posterTime(document);
  const limit = options.maxPosterNodes ?? DEFAULT_MAX_POSTER_NODES;

  let poster = '';
  // Rendered once to count: a document with hundreds of elements produces an SVG
  // large enough that inlining it is a worse trade than a blank frame.
  const svg = renderDocumentToSvg(document, at, { standalone: false });
  const nodeCount = (svg.match(/<[a-z]/g) ?? []).length;
  if (nodeCount <= limit) {
    poster = `<svg class="${CLASS.embedPoster}" viewBox="0 0 ${document.canvas.width} ${document.canvas.height}" role="img" aria-label="${escapeXmlAttr(document.title || document.id)}" preserveAspectRatio="xMidYMid meet">${svg}</svg>`;
  }

  return [
    `<div class="${CLASS.embed}" data-clotho-id="${escapeXmlAttr(document.id)}" data-clotho-poster="${at}">`,
    `<script type="application/json" data-clotho-document>${embedJson(document)}</script>`,
    poster,
    '</div>',
  ].join('');
}

/**
 * remark plugin: turn ```clotho fences into embeds.
 *
 * Shaped as a plugin factory so it drops straight into a remark pipeline, but the
 * transform itself is an ordinary function over a tree and is exported for testing.
 */
export function remarkClotho(options: RemarkClothoOptions = {}) {
  return (tree: MarkdownNode) => transformTree(tree, options);
}

export function transformTree(tree: MarkdownNode, options: RemarkClothoOptions = {}): MarkdownNode {
  const lang = options.lang ?? 'clotho';
  const strict = options.strict ?? true;

  const visit = (node: MarkdownNode): void => {
    if (!node.children) return;
    node.children = node.children.map((child) => {
      if (child.type !== 'code' || child.lang !== lang) {
        visit(child);
        return child;
      }

      let raw: unknown;
      try {
        raw = JSON.parse(child.value ?? '');
      } catch (cause) {
        return fail(child, `not valid JSON — ${(cause as Error).message}`, strict, options);
      }

      const parsed = parseDocument(raw);
      if (!parsed.ok) {
        return fail(
          child,
          `not a valid clotho document:\n  ${parsed.issues.join('\n  ')}`,
          strict,
          options,
        );
      }

      const poster = child.meta ? posterFromMeta(child.meta) : undefined;
      return {
        type: 'html',
        value: renderEmbed(parsed.document, {
          poster,
          maxPosterNodes: options.maxPosterNodes,
        }),
      };
    });
  };

  visit(tree);
  return tree;
}

/** `poster=3000` in the fence info string. */
function posterFromMeta(meta: string): number | undefined {
  const match = /\bposter=(\d+)\b/.exec(meta);
  return match ? Number(match[1]) : undefined;
}

function fail(
  node: MarkdownNode,
  message: string,
  strict: boolean,
  options: RemarkClothoOptions,
): MarkdownNode {
  const line = node.position?.start?.line;
  const where = line === undefined ? '' : ` (line ${line})`;
  const full = `clotho: fence${where} is ${message}`;
  if (strict) throw new Error(full);
  options.onError?.(full, node);
  // Left as an ordinary code block: the reader sees the source instead of a hole,
  // which is the same choice the runtime makes for an unresolved asset.
  return { ...node, lang: 'json' };
}

export interface HydrateOptions {
  /** Root to search. Defaults to the whole document. */
  readonly root?: ParentNode;
  /** Passed through to `mountPlayer`. */
  readonly player?: Record<string, unknown>;
  /**
   * Promote every embed immediately instead of waiting for it to scroll into view.
   */
  readonly eager?: boolean;
}

const HYDRATED = 'data-clotho-hydrated';

/**
 * Promote inlined posters to players.
 *
 * Lazy by default: the document JSON is already in the page, but building a scene
 * and starting a clock for an animation three screens down is work nobody asked for.
 * The dom adapter is imported dynamically so a page with no embeds — or a server
 * render — never loads it.
 */
export async function hydrateClothoEmbeds(options: HydrateOptions = {}): Promise<number> {
  if (typeof globalThis.document === 'undefined') return 0;
  const root = options.root ?? globalThis.document;
  const embeds = Array.from(
    root.querySelectorAll<HTMLElement>(`.${CLASS.embed}:not([${HYDRATED}])`),
  );
  if (embeds.length === 0) return 0;

  const { mountPlayer } = await import('../dom/mount');

  const promote = (embed: HTMLElement): void => {
    // Marked before mounting, not after: an IntersectionObserver can fire twice for
    // the same element before the first mount finishes.
    if (embed.hasAttribute(HYDRATED)) return;
    embed.setAttribute(HYDRATED, 'true');

    const payload = embed.querySelector('script[data-clotho-document]')?.textContent;
    if (!payload) return;
    const parsed = parseDocument(JSON.parse(payload));
    if (!parsed.ok) return;

    embed.replaceChildren();
    mountPlayer(embed, parsed.document, options.player ?? {});
  };

  if (options.eager || typeof IntersectionObserver === 'undefined') {
    for (const embed of embeds) promote(embed);
    return embeds.length;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        promote(entry.target as HTMLElement);
      }
    },
    { rootMargin: '200px' },
  );
  for (const embed of embeds) observer.observe(embed);
  return embeds.length;
}
