// Presenting from a document.
//
// The keyboard is the whole interface. A speaker is looking at an audience, not
// hunting for a play button, so advancing has to be one key and it has to do the
// right thing without being aimed.
//
// The right thing is to *play the segment*, not to jump to its end. The animation is
// part of the explanation; skipping it leaves the room looking at a result with no
// account of how it got there.

import type { AnimationDocument } from '../core/schema/document';
import { chapterSegments, segmentAt, type ChapterSegment } from '../core/presenter';
import { CLASS } from './strings';
import { mountStage, type MountOptions, type StageHandle } from './mount';

export interface PresenterOptions extends MountOptions {
  /** Show the speaker notes overlay from the start. Toggled with `N`. */
  readonly notes?: boolean;
  /** Element to listen on. Defaults to the document, so keys work without focus. */
  readonly keyTarget?: {
    addEventListener: EventTarget['addEventListener'];
    removeEventListener: EventTarget['removeEventListener'];
  };
}

export interface PresenterHandle extends StageHandle {
  readonly root: HTMLElement;
  /** Segments in order, for a caller building its own controls. */
  readonly segments: readonly ChapterSegment[];
  /** Play the segment at `index` and stop at its end. */
  go(index: number): void;
  next(): void;
  previous(): void;
  toggleNotes(): void;
  toggleBlackout(): void;
}

export function mountPresenter(
  container: HTMLElement,
  doc: AnimationDocument,
  options: PresenterOptions = {},
): PresenterHandle {
  const segments = chapterSegments(doc);

  const root = document.createElement('div');
  root.className = CLASS.presenter;
  container.append(root);

  const stageHost = document.createElement('div');
  root.append(stageHost);
  const stage = mountStage(stageHost, doc, {
    ...options,
    player: { ...options.player, autoplay: false },
  });

  const notes = document.createElement('aside');
  notes.className = CLASS.presenterNotes;
  notes.hidden = options.notes !== true;
  root.append(notes);

  const blackout = document.createElement('div');
  blackout.className = CLASS.presenterBlackout;
  blackout.hidden = true;
  root.append(blackout);

  let index = 0;
  let stopAt: number | null = null;

  const renderNotes = (): void => {
    const segment = segments[index]!;
    const next = segments[index + 1];
    notes.replaceChildren();

    const heading = document.createElement('p');
    heading.className = CLASS.presenterStep;
    heading.textContent = `${segment.index + 1} / ${segments.length} · ${segment.label}`;
    notes.append(heading);

    if (segment.notes) {
      const body = document.createElement('p');
      body.textContent = segment.notes;
      notes.append(body);
    }
    if (next) {
      const upcoming = document.createElement('p');
      upcoming.className = CLASS.presenterNext;
      upcoming.textContent = `다음 · ${next.label}`;
      notes.append(upcoming);
    }
  };

  const go = (target: number): void => {
    // Cleared before anything else. The seek below publishes a state change, and a
    // stop still armed for the segment being left would fire against the new index —
    // advancing two steps at once, which is exactly what happens when a speaker
    // presses forward before the current step has finished playing.
    stopAt = null;

    index = Math.max(0, Math.min(target, segments.length - 1));
    const segment = segments[index]!;
    stage.player.seek(segment.from);
    renderNotes();
    // A zero-length segment — two chapters at the same time — has nothing to play,
    // so playing it would just run into the next one.
    if (segment.to > segment.from) {
      stopAt = segment.to;
      stage.player.play();
    } else {
      stopAt = null;
    }
  };

  // Stopping is done here rather than with a timer: the player's own state is the
  // only thing that knows about speed changes and pauses.
  const unsubscribe = stage.player.subscribe((state) => {
    if (stopAt === null || !state.playing) return;
    if (state.time >= stopAt) {
      stopAt = null;
      stage.player.pause();
      stage.player.seek(segments[index]!.to);
    }
  });

  const onKey = (event: Event): void => {
    const key = (event as KeyboardEvent).key;
    switch (key) {
      case 'ArrowRight':
      case 'ArrowDown':
      case ' ':
      case 'PageDown':
        event.preventDefault();
        go(index + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
      case 'PageUp':
        event.preventDefault();
        go(index - 1);
        break;
      case 'p':
      case 'P':
        stage.player.toggle();
        break;
      case 'n':
      case 'N':
        notes.hidden = !notes.hidden;
        break;
      case 'b':
      case 'B':
        blackout.hidden = !blackout.hidden;
        break;
      case 'f':
      case 'F':
        // Best effort: fullscreen is gated on a user gesture and refused outside one.
        void root.requestFullscreen?.().catch(() => {});
        break;
      default:
        break;
    }
  };

  const keyTarget = options.keyTarget ?? document;
  keyTarget.addEventListener('keydown', onKey);
  go(0);

  return {
    ...stage,
    root,
    segments,
    go,
    next: () => go(index + 1),
    previous: () => go(index - 1),
    toggleNotes: () => {
      notes.hidden = !notes.hidden;
    },
    toggleBlackout: () => {
      blackout.hidden = !blackout.hidden;
    },
    destroy() {
      keyTarget.removeEventListener('keydown', onKey);
      unsubscribe();
      stage.destroy();
      root.remove();
    },
  };
}

/** Which segment a time falls in, re-exported for a caller building its own UI. */
export { segmentAt };
