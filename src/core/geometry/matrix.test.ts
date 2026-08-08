import { describe, expect, it } from 'bun:test';
import {
  IDENTITY,
  applyToPoint,
  groupMatrix,
  isIdentity,
  multiply,
  rotation,
  scaling,
  toSvgTransform,
  translation,
} from './matrix';

describe('matrix', () => {
  it('leaves points untouched under identity', () => {
    expect(applyToPoint(IDENTITY, { x: 3, y: 7 })).toEqual({ x: 3, y: 7 });
    expect(isIdentity(IDENTITY)).toBe(true);
    expect(isIdentity(translation(1, 0))).toBe(false);
  });

  it('translates', () => {
    expect(applyToPoint(translation(10, -5), { x: 1, y: 1 })).toEqual({ x: 11, y: -4 });
  });

  it('rotates about the origin', () => {
    const p = applyToPoint(rotation(90), { x: 1, y: 0 });
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(1);
  });

  it('rotates about an arbitrary center', () => {
    const p = applyToPoint(rotation(180, 5, 5), { x: 6, y: 5 });
    expect(p.x).toBeCloseTo(4);
    expect(p.y).toBeCloseTo(5);
  });

  it('scales', () => {
    expect(applyToPoint(scaling(2, 3), { x: 2, y: 2 })).toEqual({ x: 4, y: 6 });
  });

  it('applies the left operand first when composing', () => {
    // translate(10,0) then rotate(90): the translation happens in the parent frame.
    const m = multiply(translation(10, 0), rotation(90));
    const p = applyToPoint(m, { x: 1, y: 0 });
    expect(p.x).toBeCloseTo(10);
    expect(p.y).toBeCloseTo(1);
  });

  it('is associative', () => {
    const a = translation(3, 4);
    const b = rotation(30);
    const c = scaling(2);
    const left = multiply(multiply(a, b), c);
    const right = multiply(a, multiply(b, c));
    for (let i = 0; i < 6; i += 1) expect(left[i]).toBeCloseTo(right[i]!);
  });

  it('builds a group transform as translate-then-rotate', () => {
    const m = groupMatrix(100, 100, 90);
    expect(applyToPoint(m, { x: 0, y: 0 })).toEqual({ x: 100, y: 100 });
    const p = applyToPoint(m, { x: 10, y: 0 });
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(110);
  });

  it('shortcuts to a pure translation at zero rotation', () => {
    expect(groupMatrix(5, 6, 0)).toEqual(translation(5, 6));
  });

  it('serializes stably, without float noise or negative zero', () => {
    expect(toSvgTransform(translation(5, 6))).toBe('matrix(1 0 0 1 5 6)');
    expect(toSvgTransform(rotation(90))).toBe('matrix(0 1 -1 0 0 0)');
    expect(toSvgTransform(rotation(180))).toBe('matrix(-1 0 0 -1 0 0)');
  });
});
