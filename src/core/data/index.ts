import type { AnimationDocument } from '../schema/document';
import type { DataBinding, DataValue } from '../schema/data';

export interface BindingFinding {
  readonly elementId: string;
  readonly property: string;
  readonly pointer: string;
  readonly message: string;
}

export interface BindingCompileResult {
  readonly document: AnimationDocument;
  readonly findings: readonly BindingFinding[];
}

const BINDABLE_PROPERTIES = new Set([
  'content',
  'label',
  'subtitle',
  'color',
  'fill',
  'stroke',
  'labelColor',
  'x',
  'y',
  'cx',
  'cy',
  'r',
  'width',
  'height',
  'strokeWidth',
  'fontSize',
  'visible',
]);

export function bindablePropertiesFor(element: AnimationDocument['elements'][number]): string[] {
  const record = element as unknown as Record<string, unknown>;
  return [...BINDABLE_PROPERTIES].filter(
    (property) =>
      property === 'visible' || ['string', 'number', 'boolean'].includes(typeof record[property]),
  );
}

export function resolveJsonPointer(root: unknown, pointer: string): unknown {
  if (pointer === '') return root;
  return pointer
    .slice(1)
    .split('/')
    .map((token) => token.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce<unknown>((value, token) => {
      if (Array.isArray(value)) return /^\d+$/.test(token) ? value[Number(token)] : undefined;
      if (typeof value === 'object' && value !== null)
        return (value as Record<string, unknown>)[token];
      return undefined;
    }, root);
}

export function formatBindingValue(
  value: unknown,
  binding: DataBinding,
): string | number | boolean | undefined {
  const source = value ?? binding.fallback;
  if (source === undefined || source === null) return undefined;
  switch (binding.formatter) {
    case 'string':
      return String(source);
    case 'number': {
      const parsed = Number(source);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    case 'fixed': {
      const parsed = Number(source);
      return Number.isFinite(parsed) ? parsed.toFixed(binding.digits ?? 0) : undefined;
    }
    case 'percent': {
      const parsed = Number(source);
      return Number.isFinite(parsed)
        ? `${(parsed * 100).toFixed(binding.digits ?? 0)}%`
        : undefined;
    }
    case 'uppercase':
      return String(source).toLocaleUpperCase();
    case 'lowercase':
      return String(source).toLocaleLowerCase();
    case 'color':
      return typeof source === 'string' && /^(?:#|rgb|hsl|var\()/.test(source) ? source : undefined;
    default:
      return typeof source === 'string' || typeof source === 'number' || typeof source === 'boolean'
        ? source
        : JSON.stringify(source);
  }
}

export function compileDataBindings(
  input: AnimationDocument,
  data?: Readonly<Record<string, DataValue>>,
): BindingCompileResult {
  const source = data ?? (input.data as Readonly<Record<string, DataValue>>);
  const compiledDocument = structuredClone(input);
  const findings: BindingFinding[] = [];
  compiledDocument.data = structuredClone(source) as Record<string, DataValue>;
  compiledDocument.elements = compiledDocument.elements.map((element) => {
    let next = { ...element } as typeof element & Record<string, unknown>;
    for (const binding of element.bindings) {
      if (!BINDABLE_PROPERTIES.has(binding.property)) {
        findings.push({
          elementId: element.id,
          property: binding.property,
          pointer: binding.pointer,
          message: 'property is not in the safe binding allowlist',
        });
        continue;
      }
      const raw = resolveJsonPointer(source, binding.pointer);
      const value = formatBindingValue(raw, binding);
      if (value === undefined) {
        findings.push({
          elementId: element.id,
          property: binding.property,
          pointer: binding.pointer,
          message: 'pointer did not resolve to a compatible value',
        });
        continue;
      }
      if (binding.property === 'visible') {
        if (typeof value !== 'boolean') {
          findings.push({
            elementId: element.id,
            property: binding.property,
            pointer: binding.pointer,
            message: 'visible bindings require a boolean value',
          });
          continue;
        }
        if (!value) next.appearances = [];
        continue;
      }
      const current = next[binding.property];
      if (
        typeof current !== typeof value ||
        !['string', 'number', 'boolean'].includes(typeof current)
      ) {
        findings.push({
          elementId: element.id,
          property: binding.property,
          pointer: binding.pointer,
          message: `binding result must match the ${typeof current} property type`,
        });
        continue;
      }
      next = { ...next, [binding.property]: value };
    }
    return next as typeof element;
  });
  return { document: compiledDocument, findings };
}
