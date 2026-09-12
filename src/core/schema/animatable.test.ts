// The animatable-property registry is derived from the element schemas, so these
// tests are really about that derivation holding: a new element type or a renamed
// field must show up here without anyone editing a list.

import { describe, expect, it } from 'bun:test';
import { animatablePropertiesFor, elementTypesWithProperty } from './animatable';
import { elementSchema, type AnimationElement } from './elements';

const rect = { type: 'rect', id: 'r', x: 0, y: 0, width: 1, height: 1 } as AnimationElement;
const text = { type: 'text', id: 't', x: 0, y: 0, content: 'hi' } as AnimationElement;

describe('animatablePropertiesFor', () => {
  it('covers every element type the schema declares', () => {
    for (const option of elementSchema.options) {
      const type = (option.shape.type as unknown as { _def: { value: string } })._def.value;
      const element = { type } as AnimationElement;
      expect(animatablePropertiesFor(element).size).toBeGreaterThan(0);
    }
  });

  it('includes the type-specific fields', () => {
    expect(animatablePropertiesFor(rect).has('cornerRadius')).toBe(true);
    expect(animatablePropertiesFor(text).has('fontSize')).toBe(true);
  });

  it('includes shared fields that are genuinely animatable', () => {
    expect(animatablePropertiesFor(rect).has('rotation')).toBe(true);
  });

  // A track animating `tracks` is not a thing. These are structure, and the point of
  // the exclusion is that the check catches them rather than waving them through
  // just because the key exists on the element.
  it('excludes structural fields', () => {
    for (const key of ['id', 'type', 'parentId', 'tracks', 'bindings', 'appearances']) {
      expect(animatablePropertiesFor(rect).has(key)).toBe(false);
    }
  });

  it('does not leak one type’s fields into another', () => {
    expect(animatablePropertiesFor(text).has('fill')).toBe(false);
    expect(animatablePropertiesFor(rect).has('content')).toBe(false);
  });
});

describe('elementTypesWithProperty', () => {
  it('lists the types that declare a shared property', () => {
    expect(elementTypesWithProperty('fill')).toContain('rect');
    expect(elementTypesWithProperty('fill')).toContain('circle');
    expect(elementTypesWithProperty('fill')).not.toContain('text');
  });

  // The corpus offenders are all of this shape: a real property, wrong element type.
  it('finds the owner of a property the author put on the wrong type', () => {
    expect(elementTypesWithProperty('subtitle')).toEqual(['rect']);
  });

  it('returns nothing for a name no element has', () => {
    expect(elementTypesWithProperty('nonsense')).toEqual([]);
  });

  it('does not offer structural fields as owners', () => {
    expect(elementTypesWithProperty('tracks')).toEqual([]);
  });
});
