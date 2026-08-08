// The legacy engine's runtime, preserved verbatim as the reference clotho must match.
//
// This is a *frozen copy* of `schema/runtime.ts` from the engine clotho replaces,
// recovered from the consumer repository before that package was deleted. It is not
// used at runtime and must never be edited: its whole value is being the thing clotho's
// output is compared against.
//
// `scripts/verify-legacy-equivalence.ts` prefers the live copy under `.private/` when it
// is present and falls back to this one, so the differential check keeps working after
// the consumers finish migrating — which is exactly when it becomes hard to reproduce
// and easy to lose.
//
// Type imports are erased at build time, so the sibling schema modules it referenced are
// replaced with structural placeholders rather than vendored too.

/* eslint-disable */

type Appearance = any;
type Ease = any;
type EntryMode = any;
type ExitMode = any;
type PropertyTrack = any;
type AnimationElement = any;
type AnimationDef = any;
type Chapter = any;
type AnimationEffect = any;

// ── inlined from the legacy schema/keys.ts ──────────────────────────────────

const NUMERIC_KEYS = new Set([
  'x', 'y', 'width', 'height', 'cx', 'cy', 'r',
  'x1', 'y1', 'x2', 'y2',
  'rotation', 'opacity', 'strokeWidth', 'cornerRadius',
  'fontSize', 'labelSize', 'subtitleSize', 'curvature',
]);
const COLOR_KEYS = new Set(['fill', 'stroke', 'color', 'labelColor']);
const TEXT_KEYS = new Set(['label', 'subtitle', 'content', 'src']);

export function isNumericKey(key: string): boolean {
  return NUMERIC_KEYS.has(key);
}
export function isColorKey(key: string): boolean {
  return COLOR_KEYS.has(key);
}
export function isTextKey(key: string): boolean {
  return TEXT_KEYS.has(key);
}

// ── legacy schema/runtime.ts ────────────────────────────────────────────────

export type ElementVisualState = Record<string, unknown> & {
  visible: boolean;
  __entryProgress?: number;
  __entryMode?: EntryMode;
  __exitProgress?: number;
  __exitMode?: ExitMode;
};

export type SnapshotMap = Map<string, ElementVisualState>;

function easeApply(fn: Ease, t: number): number {
  if (fn === 'linear') return t;
  if (fn === 'easeIn') return t * t;
  if (fn === 'easeOut') return 1 - (1 - t) * (1 - t);
  const a = 2 * t * t;
  const b = 1 - Math.pow(-2 * t + 2, 2) / 2;
  return t < 0.5 ? a : b;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function parseColor(s: string): [number, number, number, number] | null {
  if (!s) return null;
  const hex6 = s.match(/^#([0-9a-f]{6})$/i);
  if (hex6) {
    const n = parseInt(hex6[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
  }
  const hex8 = s.match(/^#([0-9a-f]{8})$/i);
  if (hex8) {
    const n = parseInt(hex8[1], 16);
    return [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const short = s.match(/^#([0-9a-f]{3})$/i);
  if (short) {
    const r = parseInt(short[1][0] + short[1][0], 16);
    const g = parseInt(short[1][1] + short[1][1], 16);
    const b = parseInt(short[1][2] + short[1][2], 16);
    return [r, g, b, 255];
  }
  return null;
}

function rgbaToHex(r: number, g: number, b: number, a: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  if (a >= 255) return '#' + c(r) + c(g) + c(b);
  return '#' + c(r) + c(g) + c(b) + c(a);
}

function lerpValue(prev: unknown, target: unknown, t: number, key: string): unknown {
  if (typeof prev === 'number' && typeof target === 'number' && isNumericKey(key)) {
    return lerp(prev, target, t);
  }
  if (typeof prev === 'string' && typeof target === 'string' && isColorKey(key)) {
    const a = parseColor(prev);
    const b = parseColor(target);
    if (!a || !b) return t < 0.5 ? prev : target;
    return rgbaToHex(lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3], b[3], t));
  }
  if (typeof prev === 'string' && typeof target === 'string' && isTextKey(key)) {
    return t < 0.5 ? prev : target;
  }
  return t < 0.5 ? prev : target;
}

function trackValueAt(track: PropertyTrack, time: number): unknown {
  const kfs = track.keyframes;
  if (kfs.length === 0) return undefined;
  if (time <= kfs[0].time) return kfs[0].value;
  if (time >= kfs[kfs.length - 1].time) return kfs[kfs.length - 1].value;
  for (let i = 0; i < kfs.length - 1; i += 1) {
    const a = kfs[i];
    const b = kfs[i + 1];
    if (time >= a.time && time <= b.time) {
      const span = b.time - a.time;
      if (span <= 0) return b.value;
      const localT = (time - a.time) / span;
      const eased = easeApply(b.ease ?? 'easeInOut', localT);
      return lerpValue(a.value, b.value, eased, track.property);
    }
  }
  return kfs[kfs.length - 1].value;
}

export function activeAppearance(el: AnimationElement, time: number): {
  appearance: Appearance;
  phase: 'entry' | 'visible' | 'exit';
  phaseProgress: number;
} | null {
  if (!el.appearances || el.appearances.length === 0) return null;
  for (const ap of el.appearances) {
    if (time < ap.start) continue;
    if (time > ap.end) continue;
    const entryEnd = ap.start + (ap.entryMode && ap.entryMode !== 'instant' ? ap.entryDuration : 0);
    const exitStart = ap.end - (ap.exitMode && ap.exitMode !== 'instant' ? ap.exitDuration : 0);
    if (time < entryEnd) {
      const progress = entryEnd === ap.start ? 1 : (time - ap.start) / (entryEnd - ap.start);
      return { appearance: ap, phase: 'entry', phaseProgress: Math.max(0, Math.min(1, progress)) };
    }
    if (time > exitStart) {
      const progress = ap.end === exitStart ? 1 : (time - exitStart) / (ap.end - exitStart);
      return { appearance: ap, phase: 'exit', phaseProgress: Math.max(0, Math.min(1, progress)) };
    }
    return { appearance: ap, phase: 'visible', phaseProgress: 1 };
  }
  return null;
}

export function computeSnapshot(def: AnimationDef, time: number): SnapshotMap {
  const snap: SnapshotMap = new Map();
  for (const el of def.elements) {
    const base: ElementVisualState = {
      ...(el as unknown as Record<string, unknown>),
      visible: false,
    };
    for (const track of el.tracks) {
      const v = trackValueAt(track, time);
      if (v !== undefined) base[track.property] = v;
    }
    const phaseInfo = activeAppearance(el, time);
    if (phaseInfo) {
      base.visible = true;
      if (phaseInfo.phase === 'entry' && phaseInfo.appearance.entryMode) {
        base.__entryMode = phaseInfo.appearance.entryMode;
        base.__entryProgress = phaseInfo.phaseProgress;
      } else if (phaseInfo.phase === 'exit' && phaseInfo.appearance.exitMode) {
        base.__exitMode = phaseInfo.appearance.exitMode;
        base.__exitProgress = phaseInfo.phaseProgress;
      }
    }
    snap.set(el.id, base);
  }
  return snap;
}

export function currentChapter(def: AnimationDef, time: number): { index: number; chapter: Chapter } | null {
  if (def.chapters.length === 0) return null;
  const sorted = [...def.chapters].sort((a, b) => a.time - b.time);
  let active: { index: number; chapter: Chapter } | null = null;
  for (let i = 0; i < sorted.length; i += 1) {
    if (sorted[i].time <= time) active = { index: i, chapter: sorted[i] };
    else break;
  }
  return active;
}

export function activeEffects(def: AnimationDef, time: number): AnimationEffect[] {
  return def.effects.filter((eff) => time >= eff.time && time < eff.time + eff.duration);
}
