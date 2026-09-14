// Scale tests. Everything here is arithmetic, so the interesting cases are the
// degenerate ones — a domain of one value, an empty band, a zero-width range.

import { describe, expect, it } from 'bun:test';
import { bandScale, extent, linearScale, niceDomain, tickStep } from './scale';

describe('linearScale', () => {
  const scale = linearScale([0, 100], [0, 500]);

  it('maps the domain onto the range', () => {
    expect(scale.scale(0)).toBe(0);
    expect(scale.scale(50)).toBe(250);
    expect(scale.scale(100)).toBe(500);
  });

  it('extrapolates outside the domain rather than clamping', () => {
    expect(scale.scale(150)).toBe(750);
    expect(scale.scale(-10)).toBe(-50);
  });

  it('inverts', () => {
    expect(scale.invert(250)).toBe(50);
    expect(scale.invert(scale.scale(37))).toBeCloseTo(37, 9);
  });

  it('handles an inverted range, which is what a y axis is', () => {
    const y = linearScale([0, 10], [300, 0]);
    expect(y.scale(0)).toBe(300);
    expect(y.scale(10)).toBe(0);
    expect(y.scale(5)).toBe(150);
  });

  it('puts a zero-width domain in the middle instead of producing infinity', () => {
    const flat = linearScale([7, 7], [0, 200]);
    expect(flat.scale(7)).toBe(100);
    expect(Number.isFinite(flat.scale(99))).toBe(true);
  });

  it('survives a non-finite input', () => {
    expect(Number.isFinite(scale.scale(NaN))).toBe(true);
  });
});

describe('ticks', () => {
  it('produces round numbers covering the domain', () => {
    expect(linearScale([0, 100], [0, 1]).ticks(5)).toEqual([0, 20, 40, 60, 80, 100]);
  });

  it('picks a 1/2/5 step rather than dividing the span evenly', () => {
    const ticks = linearScale([0, 4823], [0, 1]).ticks(5);
    expect(ticks[0]).toBe(0);
    expect(ticks[1]).toBe(1000);
    expect(ticks.at(-1)).toBe(4000);
  });

  it('does not emit float noise', () => {
    for (const tick of linearScale([0, 1], [0, 1]).ticks(5)) {
      expect(String(tick).length).toBeLessThan(6);
    }
  });

  it('returns the single value for a zero-width domain', () => {
    expect(linearScale([5, 5], [0, 1]).ticks(5)).toEqual([5]);
  });

  it('handles negative domains, staying inside them', () => {
    // Ticks are multiples of the step within the domain, so they need not reach the
    // endpoints — that is what `niceDomain` is for, applied before the scale is built.
    const ticks = linearScale([-50, 50], [0, 1]).ticks(4);
    expect(ticks).toContain(0);
    expect(Math.min(...ticks)).toBeGreaterThanOrEqual(-50);
    expect(Math.max(...ticks)).toBeLessThanOrEqual(50);
  });

  it('reaches the endpoints once the domain has been nicened', () => {
    const [min, max] = niceDomain(-50, 50, 4);
    const ticks = linearScale([min, max], [0, 1]).ticks(4);
    expect(ticks[0]).toBe(min);
    expect(ticks.at(-1)).toBe(max);
  });
});

describe('niceDomain', () => {
  it('rounds outward to a step a reader can name', () => {
    expect(niceDomain(0, 4823, 5)).toEqual([0, 5000]);
    expect(niceDomain(3, 97, 5)).toEqual([0, 100]);
  });

  it('never shrinks the data range', () => {
    const [min, max] = niceDomain(12, 88, 5);
    expect(min).toBeLessThanOrEqual(12);
    expect(max).toBeGreaterThanOrEqual(88);
  });

  it('gives a single value room to sit in', () => {
    const [min, max] = niceDomain(42, 42);
    expect(min).toBeLessThan(42);
    expect(max).toBeGreaterThan(42);
  });

  it('falls back to a unit domain for non-finite input', () => {
    expect(niceDomain(NaN, 5)).toEqual([0, 1]);
  });
});

describe('tickStep', () => {
  it('stays in the 1/2/5 family', () => {
    for (const [min, max] of [
      [0, 1],
      [0, 9],
      [0, 33],
      [0, 4823],
      [0, 0.07],
    ] as const) {
      const step = tickStep(min, max, 5);
      const mantissa = step / Math.pow(10, Math.floor(Math.log10(step)));
      expect([1, 2, 5, 10]).toContain(Math.round(mantissa));
    }
  });
});

describe('bandScale', () => {
  const band = bandScale(['a', 'b', 'c', 'd'], [0, 400]);

  it('divides the range evenly', () => {
    expect(band.bandwidth).toBe(100);
    expect(band.scale('a')).toBe(0);
    expect(band.scale('c')).toBe(200);
    expect(band.center('a')).toBe(50);
  });

  it('takes padding out of each slot, keeping bands centred', () => {
    const padded = bandScale(['a', 'b'], [0, 200], 0.2);
    expect(padded.bandwidth).toBe(80);
    expect(padded.scale('a')).toBe(10);
    expect(padded.center('a')).toBe(50);
    expect(padded.center('b')).toBe(150);
  });

  it('falls back to the range start for an unknown category', () => {
    expect(band.scale('zzz')).toBe(0);
  });

  it('does not divide by zero on an empty domain', () => {
    const empty = bandScale([], [0, 100]);
    expect(Number.isFinite(empty.bandwidth)).toBe(true);
  });

  it('clamps absurd padding rather than producing a negative bandwidth', () => {
    expect(bandScale(['a'], [0, 100], 5).bandwidth).toBeGreaterThan(0);
  });
});

describe('extent', () => {
  it('ignores non-finite values', () => {
    expect(extent([3, NaN, 1, Infinity, 9])).toEqual([1, 9]);
  });

  it('is null when nothing is measurable', () => {
    expect(extent([])).toBeNull();
    expect(extent([NaN])).toBeNull();
  });
});
