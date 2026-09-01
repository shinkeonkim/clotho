import type { AnimationDocument } from '../schema/document';
import type { AnimationElement } from '../schema/elements';
import { computeSnapshot } from '../runtime/snapshot';
import { buildScene } from '../scene/build';
import type { SceneOptions } from '../scene/context';
import type { Scene } from '../scene/nodes';

export interface SceneDependencyPlan {
  readonly elementCount: number;
  readonly trackCount: number;
  readonly keyframeCount: number;
  readonly events: readonly number[];
  readonly dependencies: ReadonlyMap<string, readonly string[]>;
  changedBetween(from: number, to: number): ReadonlySet<string>;
}

export function compileSceneDependencyPlan(doc: AnimationDocument): SceneDependencyPlan {
  const events = new Set<number>([0, doc.duration]);
  const dependencies = new Map<string, Set<string>>();
  const addDependency = (source: string, dependent: string) => {
    const values = dependencies.get(source) ?? new Set<string>();
    values.add(dependent);
    dependencies.set(source, values);
  };
  let trackCount = 0;
  let keyframeCount = 0;
  for (const element of doc.elements) {
    for (const appearance of element.appearances) {
      events.add(appearance.start);
      events.add(appearance.end);
    }
    trackCount += element.tracks.length;
    for (const track of element.tracks)
      for (const keyframe of track.keyframes) {
        events.add(keyframe.time);
        keyframeCount += 1;
      }
    if (element.parentId) addDependency(element.parentId, element.id);
    if (element.type === 'line' || element.type === 'arrow') {
      if (element.fromId) addDependency(element.fromId, element.id);
      if (element.toId) addDependency(element.toId, element.id);
    }
  }
  for (const effect of doc.effects) {
    events.add(effect.time);
    events.add(effect.time + effect.duration);
    addDependency(effect.elementId, effect.elementId);
  }
  const sortedEvents = [...events].sort((a, b) => a - b);
  const frozenDependencies = new Map([...dependencies].map(([id, values]) => [id, [...values]]));
  return {
    elementCount: doc.elements.length,
    trackCount,
    keyframeCount,
    events: sortedEvents,
    dependencies: frozenDependencies,
    changedBetween(from, to) {
      const low = Math.min(from, to);
      const high = Math.max(from, to);
      const changed = new Set<string>();
      for (const element of doc.elements) {
        const elementEvents = [
          ...element.appearances.flatMap(({ start, end }) => [start, end]),
          ...element.tracks.flatMap(({ keyframes }) => keyframes.map(({ time }) => time)),
        ];
        if (
          elementEvents.some((time) => time > low && time <= high) ||
          element.tracks.some(({ keyframes }) => keyframes.length > 1 && low !== high)
        )
          changed.add(element.id);
      }
      for (const effect of doc.effects)
        if (
          (effect.time > low && effect.time <= high) ||
          (effect.time + effect.duration > low && effect.time + effect.duration <= high) ||
          (low >= effect.time && low < effect.time + effect.duration)
        )
          changed.add(effect.elementId);
      const queue = [...changed];
      for (const id of queue)
        for (const dependent of frozenDependencies.get(id) ?? [])
          if (!changed.has(dependent)) {
            changed.add(dependent);
            queue.push(dependent);
          }
      return changed;
    },
  };
}

export interface ViewportRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly overscan?: number;
}

export function cullDocumentToViewport(
  doc: AnimationDocument,
  time: number,
  viewport: ViewportRect,
): AnimationDocument {
  const snapshot = computeSnapshot(doc, time);
  const margin = viewport.overscan ?? 0;
  const left = viewport.x - margin,
    top = viewport.y - margin,
    right = viewport.x + viewport.width + margin,
    bottom = viewport.y + viewport.height + margin;
  const visible = new Set<string>();
  for (const element of doc.elements) {
    const state = snapshot.get(element.id);
    if (!state?.visible) continue;
    const bounds = approximateBounds(element, state);
    if (
      !bounds ||
      (bounds.right >= left && bounds.left <= right && bounds.bottom >= top && bounds.top <= bottom)
    )
      visible.add(element.id);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const element of doc.elements)
      if (
        (element.type === 'line' || element.type === 'arrow') &&
        ((element.fromId && visible.has(element.fromId)) ||
          (element.toId && visible.has(element.toId))) &&
        !visible.has(element.id)
      ) {
        visible.add(element.id);
        changed = true;
      } else if (element.parentId && visible.has(element.id) && !visible.has(element.parentId)) {
        visible.add(element.parentId);
        changed = true;
      }
  }
  return {
    ...doc,
    elements: doc.elements.filter(({ id }) => visible.has(id)),
    effects: doc.effects.filter(({ elementId }) => visible.has(elementId)),
  };
}

function approximateBounds(
  element: AnimationElement,
  state: Record<string, unknown>,
): { left: number; top: number; right: number; bottom: number } | null {
  const number = (key: string) => (typeof state[key] === 'number' ? (state[key] as number) : 0);
  if (element.type === 'rect' || element.type === 'image')
    return {
      left: number('x'),
      top: number('y'),
      right: number('x') + number('width'),
      bottom: number('y') + number('height'),
    };
  if (element.type === 'circle')
    return {
      left: number('cx') - number('r'),
      top: number('cy') - number('r'),
      right: number('cx') + number('r'),
      bottom: number('cy') + number('r'),
    };
  if (element.type === 'text') {
    const size = number('fontSize');
    return {
      left: number('x') - (size * String(state.content ?? '').length) / 2,
      top: number('y') - size,
      right: number('x') + (size * String(state.content ?? '').length) / 2,
      bottom: number('y') + size,
    };
  }
  return null;
}

export interface PreparedSceneBuilder {
  readonly plan: SceneDependencyPlan;
  readonly stats: { readonly hits: number; readonly misses: number; readonly cachedFrames: number };
  build(time: number, options?: SceneOptions): Scene;
  clear(): void;
}

export function createPreparedSceneBuilder(
  doc: AnimationDocument,
  maxFrames = 120,
): PreparedSceneBuilder {
  const plan = compileSceneDependencyPlan(doc);
  const cache = new Map<string, Scene>();
  let hits = 0;
  let misses = 0;
  return {
    plan,
    get stats() {
      return { hits, misses, cachedFrames: cache.size };
    },
    build(time, options = {}) {
      const key = JSON.stringify([time, options.locale, options.viewportWidth, options.rawColors]);
      const existing = cache.get(key);
      if (existing) {
        hits += 1;
        return existing;
      }
      misses += 1;
      const scene = buildScene(doc, time, options);
      cache.set(key, scene);
      if (cache.size > maxFrames) cache.delete(cache.keys().next().value!);
      return scene;
    },
    clear() {
      cache.clear();
    },
  };
}
