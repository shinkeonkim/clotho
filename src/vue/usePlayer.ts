// Vue binding for the core player.
//
// The whole binding: a `shallowRef` fed by the controller's subscription, torn down
// with the effect scope. Nothing about playback is reimplemented here — which is the
// point of the controller living in the core.

import { onScopeDispose, shallowRef, type Ref } from 'vue';
import type { AnimationDocument } from '../core/schema/document';
import {
  createPlayer,
  type Player,
  type PlayerOptions,
  type PlayerState,
} from '../core/player/create-player';
import { animationFrameScheduler } from '../dom/scheduler';

export interface UsePlayerResult {
  readonly player: Player;
  /** Reactive player state. */
  readonly state: Ref<PlayerState>;
}

/**
 * Create a player for `doc` and expose its state reactively.
 *
 * `shallowRef` rather than `ref`: player state is a flat immutable snapshot, so deep
 * reactivity would only cost proxy work on every frame.
 */
export function usePlayer(
  doc: AnimationDocument,
  options: Omit<PlayerOptions, 'scheduler'> = {},
): UsePlayerResult {
  const player = createPlayer(doc, { scheduler: animationFrameScheduler, ...options });
  const state = shallowRef(player.getState());

  const unsubscribe = player.subscribe((next) => {
    state.value = next;
  });

  onScopeDispose(() => {
    unsubscribe();
    player.destroy();
  });

  return { player, state };
}
