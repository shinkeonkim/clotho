// `<clotho-player>` — the version you can paste into a page.
//
// Everything this package offers currently assumes a bundler: an import, a peer
// dependency, a path to the stylesheet. Plenty of places cannot meet that — a static
// site, a Jekyll template, the HTML block in a CMS, one page bolted onto somebody
// else's project — and adoption is usually decided in the first five minutes.
//
// A thin wrapper over the DOM adapter, which already owns the controls, the chapter
// list, reduced-motion handling and the patcher. What is new is the element
// lifecycle and the choice to render into a shadow root.

import { parseDocument } from '../core/schema';
import type { AnimationDocument } from '../core/schema/document';
import { mountPlayer, type PlayerHandle } from '../dom/mount';
import type { Player } from '../core/player/create-player';
import { CLOTHO_STYLES } from '../styles/inline';

/** Default tag name. Overridable, since a page may already own this one. */
export const CLOTHO_PLAYER_TAG = 'clotho-player';

const OBSERVED = ['src', 'theme', 'speed', 'locale', 'autoplay', 'loop'] as const;

function boolAttr(element: HTMLElement, name: string): boolean | undefined {
  if (!element.hasAttribute(name)) return undefined;
  const value = element.getAttribute(name);
  return value !== 'false';
}

/**
 * Shared across every instance on the page.
 *
 * Constructed once and adopted by each shadow root, so a page with twenty embedded
 * animations parses the stylesheet once rather than twenty times.
 */
let sheet: CSSStyleSheet | null = null;
function styleSheet(): CSSStyleSheet | null {
  if (typeof CSSStyleSheet === 'undefined') return null;
  try {
    if (!sheet) {
      sheet = new CSSStyleSheet();
      sheet.replaceSync(CLOTHO_STYLES);
    }
    return sheet;
  } catch {
    // Constructable stylesheets are not everywhere; the <style> fallback below is.
    return null;
  }
}

/** The public surface of the element, for a page holding a reference to one. */
export interface ClothoPlayer extends HTMLElement {
  /** The live player, for a page that wants to drive it. Null before it mounts. */
  readonly player: Player | null;
}

/**
 * Build the element class.
 *
 * Deferred into a function because `class X extends HTMLElement` is evaluated when
 * the module loads, and `HTMLElement` does not exist in Node. Importing this module
 * during a server render — which any Astro or Next page doing SSR will do — would
 * otherwise throw before anything had a chance to guard it.
 */
export function createClothoPlayerClass(): CustomElementConstructor {
  return class ClothoPlayerElement extends HTMLElement {
    static get observedAttributes(): readonly string[] {
      return OBSERVED;
    }

    #handle: PlayerHandle | null = null;
    #root: ShadowRoot | null = null;
    #host: HTMLElement | null = null;
    #generation = 0;

    /** The live player, for a page that wants to drive it. Null before it mounts. */
    get player(): Player | null {
      return this.#handle?.player ?? null;
    }

    connectedCallback(): void {
      if (!this.#root) {
        // Open rather than closed: a host page that wants to reach in for a
        // screenshot or a test should be able to, and there is nothing to protect.
        this.#root = this.attachShadow({ mode: 'open' });
        const adopted = styleSheet();
        if (adopted) {
          this.#root.adoptedStyleSheets = [adopted];
        } else {
          const tag = document.createElement('style');
          tag.textContent = CLOTHO_STYLES;
          this.#root.append(tag);
        }
        this.#host = document.createElement('div');
        this.#root.append(this.#host);
      }
      void this.#load();
    }

    disconnectedCallback(): void {
      // A player left mounted keeps a frame loop and an IntersectionObserver alive; an
      // element removed from a page has no business still animating.
      this.#handle?.destroy();
      this.#handle = null;
    }

    attributeChangedCallback(name: string, previous: string | null, next: string | null): void {
      if (previous === next || !this.isConnected) return;
      if (name === 'speed') {
        const speed = Number(next);
        if (this.#handle && Number.isFinite(speed)) {
          this.#handle.player.setSpeed(speed);
          return;
        }
      }
      // Everything else changes what is built rather than what is playing, so the
      // simplest correct answer is to build it again.
      void this.#load();
    }

    /** The document from a child `<script type="application/json">`, if there is one. */
    #inlineDocument(): unknown | null {
      const script = this.querySelector('script[type="application/json"]');
      if (!script?.textContent) return null;
      try {
        return JSON.parse(script.textContent);
      } catch {
        return null;
      }
    }

    async #load(retry = true): Promise<void> {
      // Every load takes a ticket. An `src` change while a fetch is in flight would
      // otherwise let the slower response win and mount the wrong document.
      const generation = ++this.#generation;

      let raw = this.#inlineDocument();
      const src = this.getAttribute('src');

      // `connectedCallback` fires as the parser reaches the opening tag, before the
      // element's own children exist — so an inline document is reliably *not* there
      // on the first look. Deferring once costs a task only in the case that would
      // otherwise fail, and nothing in the common one.
      if (raw === null && !src && retry) {
        await new Promise((done) => setTimeout(done, 0));
        if (generation !== this.#generation) return;
        await this.#load(false);
        return;
      }
      if (raw === null && src) {
        try {
          const response = await fetch(src);
          if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
          raw = await response.json();
        } catch (cause) {
          this.#fail(`could not load ${src}: ${(cause as Error).message}`);
          return;
        }
      }
      if (generation !== this.#generation) return;

      if (raw === null) {
        this.#fail('no document: set src, or add a <script type="application/json"> child');
        return;
      }

      const parsed = parseDocument(raw);
      if (!parsed.ok) {
        this.#fail(`invalid document:\n${parsed.issues.join('\n')}`);
        return;
      }

      this.#mount(parsed.document);
    }

    #mount(animation: AnimationDocument): void {
      this.#handle?.destroy();
      if (this.#host) this.#host.replaceChildren();
      this.removeAttribute('data-clotho-error');

      const theme = this.getAttribute('theme');
      const speed = Number(this.getAttribute('speed'));

      this.#handle = mountPlayer(this.#host!, animation, {
        locale: this.getAttribute('locale') ?? undefined,
        theme: theme === 'light' || theme === 'dark' ? theme : 'auto',
        player: {
          autoplay: boolAttr(this, 'autoplay'),
          loop: boolAttr(this, 'loop'),
          speed: Number.isFinite(speed) && speed > 0 ? speed : undefined,
        },
      });

      let lastChapter = this.#handle.player.getState().chapterIndex;
      let ended = false;
      this.#handle.player.subscribe((state) => {
        if (state.chapterIndex !== lastChapter) {
          lastChapter = state.chapterIndex;
          this.dispatchEvent(
            new CustomEvent('clotho-chapterchange', {
              detail: { index: state.chapterIndex, time: state.time },
              bubbles: true,
            }),
          );
        }
        // Guarded, because `ended` stays true for every subsequent state change and a
        // host binding a one-shot handler would otherwise receive it repeatedly.
        if (state.ended && !ended) {
          ended = true;
          this.dispatchEvent(new CustomEvent('clotho-ended', { bubbles: true }));
        } else if (!state.ended) {
          ended = false;
        }
      });

      this.dispatchEvent(
        new CustomEvent('clotho-ready', { detail: { id: animation.id }, bubbles: true }),
      );
    }

    /**
     * Report a failure where someone will see it.
     *
     * On the element as an attribute so CSS and tests can react, and in the shadow
     * root as text — an embed that silently occupies no space is the hardest kind of
     * breakage to notice on someone else's page.
     */
    #fail(message: string): void {
      this.setAttribute('data-clotho-error', message);
      if (this.#host) this.#host.textContent = `clotho: ${message}`;
      this.dispatchEvent(new CustomEvent('clotho-error', { detail: { message }, bubbles: true }));
    }
  };
}

/**
 * Register the element.
 *
 * A no-op without a DOM, so a server render can call it unconditionally. Idempotent
 * too: a page that loads the script twice, or two libraries that both bundle it,
 * should not throw on the second call.
 */
export function defineClothoPlayer(tag: string = CLOTHO_PLAYER_TAG): void {
  if (typeof customElements === 'undefined' || typeof HTMLElement === 'undefined') return;
  if (customElements.get(tag)) return;
  customElements.define(tag, createClothoPlayerClass());
}
