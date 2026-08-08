// Theme tests. Color cases ported from oh-my-blog's theme-colors.test.ts;
// phase-style cases from shinkeonkim's phase-styles.test.ts, rewritten for the
// structured (matrix) return type.

import { describe, expect, it } from 'bun:test';
import {
  THEME_FG_VAR,
  isTransparentColor,
  resolveElementColor,
  resolveStageBackground,
} from './colors';
import { entryStyle, exitStyle, isNoopPhaseStyle, phaseStyleFromState } from './phase-styles';
import { elementSchema } from '../schema/elements';
import { applyToPoint } from '../geometry/matrix';

const rect = elementSchema.parse({
  type: 'rect',
  id: 'r',
  x: 100,
  y: 100,
  width: 100,
  height: 100,
});
const rectState = { x: 100, y: 100, width: 100, height: 100 };
const group = elementSchema.parse({ type: 'group', id: 'g' });

describe('resolveElementColor', () => {
  it('routes the unsafe text default to the theme variable', () => {
    expect(resolveElementColor('#18181b', 'text')).toBe(THEME_FG_VAR);
    expect(resolveElementColor('#18181B', 'text')).toBe(THEME_FG_VAR);
    expect(resolveElementColor('  #18181b  ', 'text')).toBe(THEME_FG_VAR);
  });

  it('routes the unsafe label default to the theme variable', () => {
    expect(resolveElementColor('#0b0b0f', 'label')).toBe(THEME_FG_VAR);
  });

  it('does not cross the roles', () => {
    expect(resolveElementColor('#0b0b0f', 'text')).toBe('#0b0b0f');
    expect(resolveElementColor('#18181b', 'label')).toBe('#18181b');
  });

  it('leaves authored colors alone', () => {
    for (const color of ['#ff0000', 'red', 'var(--brand)', '#18181c']) {
      expect(resolveElementColor(color, 'text'), color).toBe(color);
    }
  });

  it('leaves theme-stable schema defaults alone', () => {
    expect(resolveElementColor('#a5b4fc', 'fill')).toBe('#a5b4fc');
    expect(resolveElementColor('#6366f1', 'stroke')).toBe('#6366f1');
  });

  it('passes undefined through', () => {
    expect(resolveElementColor(undefined, 'text')).toBeUndefined();
  });
});

describe('stage background', () => {
  it('treats missing, empty, transparent, and none as transparent', () => {
    for (const value of [undefined, '', 'transparent', 'none', 'TRANSPARENT', '  none ']) {
      expect(isTransparentColor(value), String(value)).toBe(true);
    }
  });

  it('treats zero-alpha rgba/hsla as transparent', () => {
    expect(isTransparentColor('rgba(0,0,0,0)')).toBe(true);
    expect(isTransparentColor('hsla(0, 0%, 0%, 0)')).toBe(true);
    expect(isTransparentColor('rgba(0,0,0,0.5)')).toBe(false);
  });

  it('shows the mat behind a transparent canvas', () => {
    expect(resolveStageBackground('transparent')).toEqual({
      svgBackground: 'transparent',
      showMat: true,
    });
  });

  it('keeps an authored background verbatim and covers the mat', () => {
    expect(resolveStageBackground('#fff')).toEqual({ svgBackground: '#fff', showMat: false });
  });
});

describe('entryStyle', () => {
  it('does nothing for instant', () => {
    expect(entryStyle('instant', 0.5, rect, rectState)).toEqual({});
    expect(isNoopPhaseStyle(entryStyle('instant', 0.5, rect, rectState))).toBe(true);
  });

  it('fades opacity with progress and adds no transform', () => {
    const style = entryStyle('fade', 0.25, rect, rectState);
    expect(style.opacity).toBe(0.25);
    expect(style.transform).toBeUndefined();
  });

  it('slides in from the named direction, arriving at the origin', () => {
    const start = entryStyle('slide-left', 0, rect, rectState);
    expect(applyToPoint(start.transform!, { x: 0, y: 0 })).toEqual({ x: -200, y: 0 });
    const end = entryStyle('slide-left', 1, rect, rectState);
    expect(applyToPoint(end.transform!, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it('slides each direction along the expected axis', () => {
    expect(
      applyToPoint(entryStyle('slide-right', 0, rect, rectState).transform!, { x: 0, y: 0 }),
    ).toEqual({ x: 200, y: 0 });
    expect(
      applyToPoint(entryStyle('slide-up', 0, rect, rectState).transform!, { x: 0, y: 0 }),
    ).toEqual({ x: 0, y: -200 });
    expect(
      applyToPoint(entryStyle('slide-down', 0, rect, rectState).transform!, { x: 0, y: 0 }),
    ).toEqual({ x: 0, y: 200 });
  });

  it('zooms about the element center, so it grows in place', () => {
    const style = entryStyle('zoom', 0, rect, rectState);
    // At progress 0 the scale floor is 0.2; the center must not move.
    const center = applyToPoint(style.transform!, { x: 150, y: 150 });
    expect(center.x).toBeCloseTo(150);
    expect(center.y).toBeCloseTo(150);
    const corner = applyToPoint(style.transform!, { x: 100, y: 100 });
    expect(corner.x).toBeCloseTo(150 - 50 * 0.2);
  });

  it('uses a higher floor for pop than for zoom', () => {
    const zoomed = applyToPoint(entryStyle('zoom', 0, rect, rectState).transform!, {
      x: 100,
      y: 150,
    });
    const popped = applyToPoint(entryStyle('pop', 0, rect, rectState).transform!, {
      x: 100,
      y: 150,
    });
    // pop starts larger, so its corner sits further from the center.
    expect(Math.abs(popped.x - 150)).toBeGreaterThan(Math.abs(zoomed.x - 150));
  });

  it('reaches full size at the end of the transition', () => {
    const style = entryStyle('zoom', 1, rect, rectState);
    expect(applyToPoint(style.transform!, { x: 100, y: 100 })).toEqual({ x: 100, y: 100 });
  });

  // Groups and code blocks have no center; scaling about the origin would fling
  // them across the stage, so they fade instead.
  it('degrades zoom to a fade when the element has no center', () => {
    const style = entryStyle('zoom', 0.5, group, {});
    expect(style.opacity).toBe(0.5);
    expect(style.transform).toBeUndefined();
  });
});

describe('exitStyle', () => {
  it('fades out with progress', () => {
    expect(exitStyle('fade', 0.25, rect, rectState).opacity).toBe(0.75);
  });

  it('slides out in the named direction, starting at the origin', () => {
    const start = exitStyle('slide-right', 0, rect, rectState);
    expect(applyToPoint(start.transform!, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    const end = exitStyle('slide-right', 1, rect, rectState);
    expect(applyToPoint(end.transform!, { x: 0, y: 0 })).toEqual({ x: 200, y: 0 });
  });

  it('shrinks toward the floor, keeping the center fixed', () => {
    const style = exitStyle('zoom', 1, rect, rectState);
    const center = applyToPoint(style.transform!, { x: 150, y: 150 });
    expect(center.x).toBeCloseTo(150);
    const corner = applyToPoint(style.transform!, { x: 100, y: 100 });
    expect(corner.x).toBeCloseTo(150 - 50 * 0.2);
  });

  it('is a no-op at the start of a zoom exit', () => {
    const style = exitStyle('zoom', 0, rect, rectState);
    expect(applyToPoint(style.transform!, { x: 100, y: 100 })).toEqual({ x: 100, y: 100 });
    expect(style.opacity).toBe(1);
  });
});

describe('phaseStyleFromState', () => {
  it('picks entry when entry bookkeeping is present', () => {
    const style = phaseStyleFromState(rect, {
      ...rectState,
      __entryMode: 'fade',
      __entryProgress: 0.4,
    });
    expect(style.opacity).toBe(0.4);
  });

  it('picks exit when exit bookkeeping is present', () => {
    const style = phaseStyleFromState(rect, {
      ...rectState,
      __exitMode: 'fade',
      __exitProgress: 0.4,
    });
    expect(style.opacity).toBeCloseTo(0.6);
  });

  it('prefers entry when both are somehow present', () => {
    const style = phaseStyleFromState(rect, {
      ...rectState,
      __entryMode: 'fade',
      __entryProgress: 0.4,
      __exitMode: 'fade',
      __exitProgress: 0.9,
    });
    expect(style.opacity).toBe(0.4);
  });

  it('returns nothing while fully visible', () => {
    expect(phaseStyleFromState(rect, rectState)).toEqual({});
  });
});
