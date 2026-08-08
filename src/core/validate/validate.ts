// Document validation beyond what the schema can express.
//
// Ported from shinkeonkim's scripts/validate-animations.mjs, promoted from a build
// script to a package API and CLI. Its comment explains why it exists, and the
// reason is worth repeating: the legacy loader returned `null` for any document
// that failed to parse, and the caller rendered "animation not found". An uppercase
// id once shipped that way — a real animation that silently never drew, with
// nothing anywhere saying so.
//
// Checks, in order of how often they catch something real:
//   - schema parse
//   - duplicate ids within each namespace (elements / chapters / effects)
//   - referential integrity (connectors, effects, images, parents)
//   - temporal bounds (times inside the duration, start before end)
//
// v1 adds parent-link checks and asset resolution, neither of which existed before.

import { parseDocument } from '../schema';
import type { AnimationDocument } from '../schema/document';
import { buildElementTree } from '../runtime/tree';

export type Severity = 'error' | 'warning';

export interface Finding {
  readonly severity: Severity;
  /** Stable machine-readable code, for tooling that wants to filter. */
  readonly code: string;
  /** Dotted path into the document, e.g. `elements.3.appearances.0.start`. */
  readonly path: string;
  readonly message: string;
}

export interface ValidationResult {
  readonly ok: boolean;
  readonly document?: AnimationDocument;
  readonly findings: Finding[];
  readonly errorCount: number;
  readonly warningCount: number;
}

function error(code: string, path: string, message: string): Finding {
  return { severity: 'error', code, path, message };
}

function warning(code: string, path: string, message: string): Finding {
  return { severity: 'warning', code, path, message };
}

/**
 * Validate a clotho v1 document.
 *
 * Legacy documents fail here with a pointed message rather than a wall of schema
 * issues — being handed an unmigrated document is a distinct mistake and deserves
 * a distinct answer.
 */
export function validateDocument(value: unknown): ValidationResult {
  const findings: Finding[] = [];

  if (isLegacyEnvelope(value)) {
    return summarize(
      [
        error(
          'legacy-document',
          'clothoVersion',
          'this is a legacy (version 3/4) document; run it through migrateLegacyDocument first',
        ),
      ],
      undefined,
    );
  }

  const parsed = parseDocument(value);
  if (!parsed.ok) {
    for (const issue of parsed.issues) {
      const [path, ...rest] = issue.split(': ');
      findings.push(error('schema', path ?? '<root>', rest.join(': ') || issue));
    }
    return summarize(findings, undefined);
  }

  const doc = parsed.document;
  checkDuplicateIds(doc, findings);
  checkReferences(doc, findings);
  checkParentLinks(doc, findings);
  checkTemporalBounds(doc, findings);
  checkAssets(doc, findings);
  checkUnknownProperties(value, doc, findings);

  return summarize(findings, doc);
}

/**
 * Report properties the schema does not define.
 *
 * zod strips unknown keys, which means an author can write a property that does
 * absolutely nothing and never hear about it. That is not hypothetical: the 383
 * documents this package was extracted from contain 22 `line.label`s (only `arrow`
 * has a label), 18 `circle.subtitle`s (only `rect` does), 7 `arrow.arrowEnd`s
 * (the field is `headEnd`), 37 `rect.strokeDasharray`s, and 182 `effect.delay`s —
 * every one of them silently discarded for years.
 *
 * Warnings rather than errors: an unknown property is inert, so the document still
 * renders. But the author asked for something and did not get it, and that deserves
 * to be said out loud.
 */
function checkUnknownProperties(raw: unknown, doc: AnimationDocument, findings: Finding[]): void {
  if (typeof raw !== 'object' || raw === null) return;
  const input = raw as Record<string, unknown>;

  compareKeys(input, doc as unknown as Record<string, unknown>, '', findings);

  const rawElements = Array.isArray(input.elements) ? input.elements : [];
  rawElements.forEach((rawElement, index) => {
    const parsedElement = doc.elements[index];
    if (!parsedElement || typeof rawElement !== 'object' || rawElement === null) return;
    compareKeys(
      rawElement as Record<string, unknown>,
      parsedElement as unknown as Record<string, unknown>,
      `elements.${index}`,
      findings,
      parsedElement.type,
    );
  });

  const rawEffects = Array.isArray(input.effects) ? input.effects : [];
  rawEffects.forEach((rawEffect, index) => {
    const parsedEffect = doc.effects[index];
    if (!parsedEffect || typeof rawEffect !== 'object' || rawEffect === null) return;
    compareKeys(
      rawEffect as Record<string, unknown>,
      parsedEffect as unknown as Record<string, unknown>,
      `effects.${index}`,
      findings,
      parsedEffect.type,
    );
  });

  const rawChapters = Array.isArray(input.chapters) ? input.chapters : [];
  rawChapters.forEach((rawChapter, index) => {
    const parsedChapter = doc.chapters[index];
    if (!parsedChapter || typeof rawChapter !== 'object' || rawChapter === null) return;
    compareKeys(
      rawChapter as Record<string, unknown>,
      parsedChapter as unknown as Record<string, unknown>,
      `chapters.${index}`,
      findings,
    );
  });
}

/** Legacy envelope keys that migration replaces; not worth warning about. */
const MIGRATION_ARTIFACTS = new Set(['version', 'childIds', 'src']);

function compareKeys(
  raw: Record<string, unknown>,
  parsed: Record<string, unknown>,
  path: string,
  findings: Finding[],
  kind?: string,
): void {
  for (const key of Object.keys(raw)) {
    if (key in parsed) continue;
    if (MIGRATION_ARTIFACTS.has(key)) continue;
    const where = path === '' ? key : `${path}.${key}`;
    const subject = kind ? `"${kind}"` : 'the document';
    findings.push(
      warning(
        'unknown-property',
        where,
        `${subject} has no property "${key}"; it is ignored — check for a typo or a field that belongs on another type`,
      ),
    );
  }
}

function isLegacyEnvelope(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { clothoVersion?: unknown; version?: unknown };
  return v.clothoVersion === undefined && (v.version === 3 || v.version === 4);
}

function summarize(findings: Finding[], document: AnimationDocument | undefined): ValidationResult {
  const errorCount = findings.filter((f) => f.severity === 'error').length;
  const warningCount = findings.length - errorCount;
  return {
    ok: errorCount === 0,
    ...(document ? { document } : {}),
    findings,
    errorCount,
    warningCount,
  };
}

/**
 * Ids must be unique within their own namespace, not across the document — an
 * effect may share an id with an element, which legacy also permitted.
 */
function checkDuplicateIds(doc: AnimationDocument, findings: Finding[]): void {
  const namespaces: [string, { id: string }[]][] = [
    ['elements', doc.elements],
    ['chapters', doc.chapters],
    ['effects', doc.effects],
  ];

  for (const [name, items] of namespaces) {
    const seen = new Set<string>();
    items.forEach((item, index) => {
      if (seen.has(item.id)) {
        findings.push(
          error('duplicate-id', `${name}.${index}.id`, `duplicate ${name} id "${item.id}"`),
        );
      }
      seen.add(item.id);
    });
  }
}

function checkReferences(doc: AnimationDocument, findings: Finding[]): void {
  const elementIds = new Set(doc.elements.map((el) => el.id));

  doc.elements.forEach((el, index) => {
    if (el.type === 'line' || el.type === 'arrow') {
      for (const [field, value] of [
        ['fromId', el.fromId],
        ['toId', el.toId],
      ] as const) {
        if (value !== undefined && !elementIds.has(value)) {
          findings.push(
            error(
              'unknown-reference',
              `elements.${index}.${field}`,
              `${el.type} "${el.id}" references element "${value}", which does not exist`,
            ),
          );
        }
      }
      const hasFrom = el.fromId !== undefined || (el.x1 !== undefined && el.y1 !== undefined);
      const hasTo = el.toId !== undefined || (el.x2 !== undefined && el.y2 !== undefined);
      if (!hasFrom || !hasTo) {
        findings.push(
          warning(
            'unresolvable-connector',
            `elements.${index}`,
            `${el.type} "${el.id}" has no resolvable ${!hasFrom ? 'start' : 'end'}; it will not render`,
          ),
        );
      }
    }
  });

  doc.effects.forEach((effect, index) => {
    if (!elementIds.has(effect.elementId)) {
      findings.push(
        error(
          'unknown-reference',
          `effects.${index}.elementId`,
          `effect "${effect.id}" targets element "${effect.elementId}", which does not exist`,
        ),
      );
    }
  });

  // Flow particles ride along a connector's path, so they have nothing to follow
  // on any other element type. Legacy silently drew nothing.
  const byId = new Map(doc.elements.map((el) => [el.id, el]));
  doc.effects.forEach((effect, index) => {
    if (effect.type !== 'flow') return;
    const target = byId.get(effect.elementId);
    if (target && target.type !== 'arrow' && target.type !== 'line') {
      findings.push(
        warning(
          'flow-target',
          `effects.${index}.elementId`,
          `flow effect "${effect.id}" targets a "${target.type}"; only arrow and line have a path to travel`,
        ),
      );
    }
  });
}

function checkParentLinks(doc: AnimationDocument, findings: Finding[]): void {
  const indexById = new Map(doc.elements.map((el, index) => [el.id, index]));
  for (const issue of buildElementTree(doc).issues) {
    const index = indexById.get(issue.elementId) ?? 0;
    findings.push(error(issue.code, `elements.${index}.parentId`, issue.message));
  }
}

function checkTemporalBounds(doc: AnimationDocument, findings: Finding[]): void {
  const { duration } = doc;

  const outOfRange = (time: number): boolean => time < 0 || time > duration;

  doc.elements.forEach((el, index) => {
    el.appearances.forEach((ap, apIndex) => {
      const base = `elements.${index}.appearances.${apIndex}`;
      if (ap.start >= ap.end) {
        findings.push(
          error(
            'inverted-window',
            `${base}.start`,
            `appearance start ${ap.start} is not before end ${ap.end}`,
          ),
        );
      }
      if (outOfRange(ap.start)) {
        findings.push(
          error('out-of-range', `${base}.start`, `start ${ap.start} is outside 0..${duration}`),
        );
      }
      if (outOfRange(ap.end)) {
        findings.push(
          error('out-of-range', `${base}.end`, `end ${ap.end} is outside 0..${duration}`),
        );
      }
    });

    el.tracks.forEach((track, trackIndex) => {
      const base = `elements.${index}.tracks.${trackIndex}`;
      track.keyframes.forEach((kf, kfIndex) => {
        if (outOfRange(kf.time)) {
          findings.push(
            error(
              'out-of-range',
              `${base}.keyframes.${kfIndex}.time`,
              `keyframe time ${kf.time} is outside 0..${duration}`,
            ),
          );
        }
      });
      const times = track.keyframes.map((kf) => kf.time);
      for (let i = 1; i < times.length; i += 1) {
        if (times[i]! < times[i - 1]!) {
          findings.push(
            warning(
              'unsorted-keyframes',
              `${base}.keyframes.${i}.time`,
              `keyframe times are not ascending (${times[i - 1]} then ${times[i]}); ` +
                'interpolation scans in order and will ignore the out-of-order frame',
            ),
          );
          break;
        }
      }
    });
  });

  doc.chapters.forEach((chapter, index) => {
    if (outOfRange(chapter.time)) {
      findings.push(
        error(
          'out-of-range',
          `chapters.${index}.time`,
          `chapter time ${chapter.time} is outside 0..${duration}`,
        ),
      );
    }
  });

  doc.effects.forEach((effect, index) => {
    if (outOfRange(effect.time)) {
      findings.push(
        error(
          'out-of-range',
          `effects.${index}.time`,
          `effect time ${effect.time} is outside 0..${duration}`,
        ),
      );
    }
    if (effect.duration === 0) {
      findings.push(
        warning(
          'zero-duration-effect',
          `effects.${index}.duration`,
          `effect "${effect.id}" has zero duration and will never fire`,
        ),
      );
    }
  });
}

function checkAssets(doc: AnimationDocument, findings: Finding[]): void {
  const declared = new Set(Object.keys(doc.assets));
  const referenced = new Set<string>();

  doc.elements.forEach((el, index) => {
    if (el.type !== 'image') return;
    referenced.add(el.assetId);
    if (!declared.has(el.assetId)) {
      findings.push(
        error(
          'unknown-asset',
          `elements.${index}.assetId`,
          `image "${el.id}" references asset "${el.assetId}", which is not in the assets map`,
        ),
      );
    }
  });

  for (const assetId of declared) {
    if (!referenced.has(assetId)) {
      findings.push(
        warning('unused-asset', `assets.${assetId}`, `asset "${assetId}" is never referenced`),
      );
    }
  }
}

/** Format findings one per line, ready to print. */
export function formatFindings(findings: readonly Finding[]): string[] {
  return findings.map(
    (f) => `${f.severity === 'error' ? 'ERROR' : 'warn '} ${f.path}: ${f.message}`,
  );
}
