import type { z } from 'zod';
import { animationDocumentSchema } from '../schema/document';
import type { effectSchema } from '../schema/effects';
import type { Appearance, Ease, Interpolation, PropertyTrack, TrackValue } from '../schema/primitives';

export type AnimationInput = z.input<typeof animationDocumentSchema>;
export type EffectInput = z.input<typeof effectSchema>;

/** Type-check, apply schema defaults, and return ordinary JSON-compatible data. */
export function defineAnimation(input: AnimationInput) {
  return animationDocumentSchema.parse(input);
}

export function appear(
  start: number,
  end: number,
  options: Partial<Omit<Appearance, 'start' | 'end'>> = {},
): Appearance {
  return { start, end, entryDuration: 300, exitDuration: 300, ...options };
}

export function track(
  property: string,
  keyframes: ReadonlyArray<{ time: number; value: TrackValue; ease?: Ease }>,
  interpolate?: Interpolation,
): PropertyTrack {
  return {
    property,
    keyframes: keyframes.map((keyframe) => ({ ...keyframe })),
    ...(interpolate ? { interpolate } : {}),
  };
}

export interface RepeatOptions extends Partial<Omit<Appearance, 'start' | 'end'>> {
  readonly count: number;
  readonly start?: number;
  readonly duration: number;
  readonly gap?: number;
}

/** Expand a repeat pattern to explicit appearance windows understood by v1 JSON. */
export function repeatAppearances(options: RepeatOptions): Appearance[] {
  const { count, start = 0, duration, gap = 0, ...appearanceOptions } = options;
  return Array.from({ length: count }, (_, index) => {
    const windowStart = start + index * (duration + gap);
    return appear(windowStart, windowStart + duration, appearanceOptions);
  });
}

/** Apply a time offset to items without introducing a non-JSON loop construct. */
export function stagger<T, R>(
  items: readonly T[],
  delay: number,
  build: (item: T, time: number, index: number) => R,
  start = 0,
): R[] {
  return items.map((item, index) => build(item, start + index * delay, index));
}

export const effects = {
  highlight(input: Omit<Extract<EffectInput, { type: 'highlight' }>, 'type'>): EffectInput {
    return { type: 'highlight', ...input };
  },
  pulse(input: Omit<Extract<EffectInput, { type: 'pulse' }>, 'type'>): EffectInput {
    return { type: 'pulse', ...input };
  },
  flow(input: Omit<Extract<EffectInput, { type: 'flow' }>, 'type'>): EffectInput {
    return { type: 'flow', ...input };
  },
};
