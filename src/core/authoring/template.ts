import { animationDocumentSchema, type AnimationDocument } from '../schema/document';
import { compileLayouts } from '../layout';
import { compileDataBindings } from '../data';
import type { z } from 'zod';

type AnimationInput = z.input<typeof animationDocumentSchema>;

type Primitive = string | number | boolean;

interface ParameterBase<T extends Primitive | unknown[]> {
  readonly description?: string;
  readonly default?: T;
}

export interface StringParameter extends ParameterBase<string> {
  readonly type: 'string';
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
}

export interface NumberParameter extends ParameterBase<number> {
  readonly type: 'number';
  readonly min?: number;
  readonly max?: number;
  readonly integer?: boolean;
}

export interface BooleanParameter extends ParameterBase<boolean> {
  readonly type: 'boolean';
}

export interface EnumParameter extends ParameterBase<string> {
  readonly type: 'enum';
  readonly values: readonly [string, ...string[]];
}

export interface ArrayParameter extends ParameterBase<unknown[]> {
  readonly type: 'array';
  readonly items: ParameterSchema;
  readonly minItems?: number;
  readonly maxItems?: number;
}

export interface ObjectParameter {
  readonly type: 'object';
  readonly description?: string;
  readonly properties: Readonly<Record<string, ParameterSchema>>;
  readonly default?: Readonly<Record<string, unknown>>;
}

export type ParameterSchema =
  | StringParameter
  | NumberParameter
  | BooleanParameter
  | EnumParameter
  | ArrayParameter
  | ObjectParameter;

export type TemplateParameters = Readonly<Record<string, ParameterSchema>>;

export interface TemplateParameterIssue {
  readonly path: string;
  readonly message: string;
}

export class TemplateParameterError extends Error {
  constructor(public readonly issues: readonly TemplateParameterIssue[]) {
    super(issues.map(({ path, message }) => `${path}: ${message}`).join('; '));
    this.name = 'TemplateParameterError';
  }
}

export interface AnimationTemplate<P extends Record<string, unknown> = Record<string, unknown>> {
  readonly id: string;
  readonly parameters: TemplateParameters;
  instantiate(values?: Partial<P>): AnimationDocument;
  reference(values?: Partial<P>): TemplateReference;
}

export interface TemplateReference {
  readonly clothoTemplate: 1;
  readonly templateId: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

export interface TemplateDefinition<P extends Record<string, unknown>> {
  readonly id: string;
  readonly parameters: TemplateParameters;
  readonly build: (parameters: P) => AnimationInput;
}

function issue(issues: TemplateParameterIssue[], path: string, message: string): undefined {
  issues.push({ path, message });
  return undefined;
}

function validateValue(
  schema: ParameterSchema,
  input: unknown,
  path: string,
  issues: TemplateParameterIssue[],
): unknown {
  const value = input === undefined ? schema.default : input;
  if (value === undefined) return issue(issues, path, 'required parameter is missing');

  if (schema.type === 'string') {
    if (typeof value !== 'string') return issue(issues, path, 'expected a string');
    if (schema.minLength !== undefined && value.length < schema.minLength)
      return issue(issues, path, `must contain at least ${schema.minLength} characters`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength)
      return issue(issues, path, `must contain at most ${schema.maxLength} characters`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value))
      return issue(issues, path, `must match ${schema.pattern}`);
    return value;
  }
  if (schema.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value))
      return issue(issues, path, 'expected a finite number');
    if (schema.integer && !Number.isInteger(value))
      return issue(issues, path, 'expected an integer');
    if (schema.min !== undefined && value < schema.min)
      return issue(issues, path, `must be at least ${schema.min}`);
    if (schema.max !== undefined && value > schema.max)
      return issue(issues, path, `must be at most ${schema.max}`);
    return value;
  }
  if (schema.type === 'boolean') {
    return typeof value === 'boolean' ? value : issue(issues, path, 'expected a boolean');
  }
  if (schema.type === 'enum') {
    return typeof value === 'string' && schema.values.includes(value)
      ? value
      : issue(issues, path, `expected one of ${schema.values.join(', ')}`);
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return issue(issues, path, 'expected an array');
    if (schema.minItems !== undefined && value.length < schema.minItems)
      issue(issues, path, `must contain at least ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems)
      issue(issues, path, `must contain at most ${schema.maxItems} items`);
    return value.map((item, index) =>
      validateValue(schema.items, item, `${path}.${index}`, issues),
    );
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return issue(issues, path, 'expected an object');
  const source = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(schema.properties).map(([key, child]) => [
      key,
      validateValue(child, source[key], `${path}.${key}`, issues),
    ]),
  );
}

export function resolveTemplateParameters(
  schema: TemplateParameters,
  values: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  const issues: TemplateParameterIssue[] = [];
  const unknown = Object.keys(values).filter((key) => schema[key] === undefined);
  for (const key of unknown) issue(issues, key, 'unknown parameter');
  const resolved = Object.fromEntries(
    Object.entries(schema).map(([key, parameter]) => [
      key,
      validateValue(parameter, values[key], key, issues),
    ]),
  );
  if (issues.length > 0) throw new TemplateParameterError(issues);
  return resolved;
}

/** Define a trusted build-time template. No executable code is stored in its JSON reference. */
export function defineTemplate<P extends Record<string, unknown>>(
  definition: TemplateDefinition<P>,
): AnimationTemplate<P> {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(definition.id))
    throw new Error('template id must be a lowercase package-style identifier');
  const instantiate = (values: Partial<P> = {}): AnimationDocument => {
    const parameters = resolveTemplateParameters(definition.parameters, values) as P;
    return compileLayouts(
      compileDataBindings(animationDocumentSchema.parse(definition.build(parameters))).document,
    ).document;
  };
  return Object.freeze({
    id: definition.id,
    parameters: definition.parameters,
    instantiate,
    reference(values: Partial<P> = {}): TemplateReference {
      const parameters = resolveTemplateParameters(definition.parameters, values);
      return { clothoTemplate: 1, templateId: definition.id, parameters };
    },
  });
}

export function instantiateTemplateReference(
  reference: TemplateReference,
  templates: ReadonlyMap<string, AnimationTemplate>,
): AnimationDocument {
  if (reference.clothoTemplate !== 1) throw new Error('unsupported template reference version');
  const template = templates.get(reference.templateId);
  if (!template) throw new Error(`unknown template: ${reference.templateId}`);
  return template.instantiate(reference.parameters);
}
