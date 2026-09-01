import type { AnimationDocument } from '../schema/document';
import type { Checkpoint, CheckpointPredicate, CheckpointResponse } from '../schema/checkpoints';
import type { Player } from '../player/create-player';

export interface CheckpointAnswer {
  readonly checkpointId: string;
  readonly value: CheckpointResponse;
  readonly correct: boolean | undefined;
}

export interface InteractionSessionState {
  readonly pending: Checkpoint | null;
  readonly answers: Readonly<Record<string, CheckpointAnswer>>;
}

export interface InteractionSessionOptions {
  readonly evaluate?: (checkpoint: Checkpoint, value: CheckpointResponse) => boolean | undefined;
  readonly initialAnswers?: Readonly<Record<string, CheckpointResponse>>;
}

export interface InteractionSession {
  getState(): InteractionSessionState;
  subscribe(listener: (state: InteractionSessionState) => void): () => void;
  answer(value: CheckpointResponse): CheckpointAnswer;
  continue(): void;
  reset(): void;
  destroy(): void;
}

function evaluatePredicate(
  predicate: CheckpointPredicate | undefined,
  value: CheckpointResponse,
): boolean | undefined {
  if (!predicate) return undefined;
  if (predicate.type === 'equals') return value === predicate.value;
  if (predicate.type === 'oneOf') return predicate.values.includes(value);
  return (
    typeof value === 'number' &&
    (predicate.min === undefined || value >= predicate.min) &&
    (predicate.max === undefined || value <= predicate.max)
  );
}

export function createInteractionSession(
  doc: AnimationDocument,
  player: Player,
  options: InteractionSessionOptions = {},
): InteractionSession {
  const checkpoints = [...doc.checkpoints].sort((a, b) => a.time - b.time);
  let answers: Record<string, CheckpointAnswer> = {};
  let pending: Checkpoint | null = null;
  let previousTime = player.getState().time;
  let bypassId: string | null = null;
  let destroyed = false;
  const listeners = new Set<(state: InteractionSessionState) => void>();

  for (const [id, value] of Object.entries(options.initialAnswers ?? {})) {
    const checkpoint = checkpoints.find((item) => item.id === id);
    if (checkpoint)
      answers[id] = {
        checkpointId: id,
        value,
        correct:
          options.evaluate?.(checkpoint, value) ??
          evaluatePredicate('predicate' in checkpoint ? checkpoint.predicate : undefined, value),
      };
  }
  let currentState: InteractionSessionState = { pending, answers: { ...answers } };
  const publish = (): void => {
    currentState = { pending, answers: { ...answers } };
    listeners.forEach((listener) => listener(currentState));
  };
  const unsubscribePlayer = player.subscribe((next) => {
    if (destroyed) return;
    if (next.time < previousTime) bypassId = null;
    const hit = checkpoints.find(
      (checkpoint) =>
        checkpoint.time > previousTime &&
        checkpoint.time <= next.time &&
        checkpoint.id !== bypassId &&
        answers[checkpoint.id] === undefined,
    );
    previousTime = next.time;
    if (!hit) return;
    player.pause();
    player.seek(hit.time);
    previousTime = hit.time;
    pending = hit;
    publish();
  });
  const initialCheckpoint = checkpoints.find(
    (checkpoint) => checkpoint.time === previousTime && answers[checkpoint.id] === undefined,
  );
  if (initialCheckpoint) {
    player.pause();
    pending = initialCheckpoint;
    currentState = { pending, answers: { ...answers } };
  }

  return {
    getState: () => currentState,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    answer(value) {
      if (!pending) throw new Error('no checkpoint is waiting for an answer');
      const predicate = 'predicate' in pending ? pending.predicate : undefined;
      const result = {
        checkpointId: pending.id,
        value,
        correct: options.evaluate?.(pending, value) ?? evaluatePredicate(predicate, value),
      };
      answers = { ...answers, [pending.id]: result };
      publish();
      return result;
    },
    continue() {
      if (!pending) return;
      if (
        pending.required &&
        pending.interaction !== 'continue' &&
        answers[pending.id] === undefined
      )
        throw new Error('the required checkpoint needs an answer');
      bypassId = pending.id;
      pending = null;
      publish();
      player.play();
    },
    reset() {
      answers = {};
      pending = null;
      bypassId = null;
      previousTime = player.getState().time;
      publish();
    },
    destroy() {
      destroyed = true;
      unsubscribePlayer();
      listeners.clear();
    },
  };
}
