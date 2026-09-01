import type { AnimationDocument } from '../schema/document';
import { measureElementBox } from '../layout';

export type LintPreset = 'correctness' | 'accessibility' | 'recommended';
export interface LintFinding {
  readonly ruleId: string;
  readonly preset: LintPreset;
  readonly severity: 'error' | 'warning';
  readonly path: string;
  readonly message: string;
  readonly elementId?: string;
  readonly time?: number;
  readonly fixable: boolean;
}
export interface LintRule {
  readonly id: string;
  readonly preset: LintPreset;
  run(document: AnimationDocument): readonly LintFinding[];
  fix?(document: AnimationDocument, finding: LintFinding): AnimationDocument;
}
export interface LintOptions {
  readonly presets?: readonly LintPreset[];
  readonly rules?: readonly LintRule[];
  readonly disabledRules?: readonly string[];
}

const finding = (
  ruleId: string,
  preset: LintPreset,
  path: string,
  message: string,
  details: Partial<LintFinding> = {},
): LintFinding => ({
  ruleId,
  preset,
  path,
  message,
  severity: 'warning',
  fixable: false,
  ...details,
});

const BUILTIN_RULES: readonly LintRule[] = [
  {
    id: 'asset/no-unused',
    preset: 'correctness',
    run(doc) {
      const used = new Set(
        doc.elements
          .filter((element) => element.type === 'image')
          .map((element) => element.assetId),
      );
      return Object.keys(doc.assets)
        .filter((id) => !used.has(id))
        .map((id) =>
          finding(this.id, this.preset, `assets.${id}`, `asset "${id}" is not used`, {
            fixable: true,
          }),
        );
    },
    fix(doc, issue) {
      const next = structuredClone(doc);
      delete next.assets[issue.path.slice('assets.'.length)];
      return next;
    },
  },
  {
    id: 'timeline/sort-keyframes',
    preset: 'correctness',
    run(doc) {
      return doc.elements.flatMap((element, elementIndex) =>
        element.tracks.flatMap((track, trackIndex) =>
          track.keyframes.some(
            (keyframe, index) => index > 0 && keyframe.time < track.keyframes[index - 1]!.time,
          )
            ? [
                finding(
                  this.id,
                  this.preset,
                  `elements.${elementIndex}.tracks.${trackIndex}.keyframes`,
                  'keyframes are not sorted by time',
                  { elementId: element.id, fixable: true },
                ),
              ]
            : [],
        ),
      );
    },
    fix(doc, issue) {
      const next = structuredClone(doc);
      const [, elementIndex, , trackIndex] = issue.path.split('.');
      next.elements[Number(elementIndex)]!.tracks[Number(trackIndex)]!.keyframes.sort(
        (a, b) => a.time - b.time,
      );
      return next;
    },
  },
  {
    id: 'i18n/no-empty-translation',
    preset: 'correctness',
    run(doc) {
      return doc.elements.flatMap((element, index) =>
        element.type === 'text'
          ? Object.entries(element.translations)
              .filter(([, value]) => value.trim() === '')
              .map(([locale]) =>
                finding(
                  this.id,
                  this.preset,
                  `elements.${index}.translations.${locale}`,
                  `empty ${locale} translation falls back to content`,
                  { elementId: element.id, fixable: true },
                ),
              )
          : [],
      );
    },
    fix(doc, issue) {
      const next = structuredClone(doc);
      const [, index, , locale] = issue.path.split('.');
      const element = next.elements[Number(index)];
      if (element?.type === 'text' && locale) delete element.translations[locale];
      return next;
    },
  },
  {
    id: 'text/overflow',
    preset: 'recommended',
    run(doc) {
      return doc.elements.flatMap((element, index) => {
        if (element.type !== 'text') return [];
        const estimated = element.content.length * element.fontSize * 0.6;
        return estimated > doc.canvas.width * 0.9
          ? [
              finding(
                this.id,
                this.preset,
                `elements.${index}.content`,
                `estimated text width ${Math.round(estimated)}px exceeds the readable stage width`,
                { elementId: element.id },
              ),
            ]
          : [];
      });
    },
  },
  {
    id: 'text/minimum-size',
    preset: 'accessibility',
    run(doc) {
      return doc.elements.flatMap((element, index) =>
        element.type === 'text' && element.fontSize < 14
          ? [
              finding(
                this.id,
                this.preset,
                `elements.${index}.fontSize`,
                'text smaller than 14px may be difficult to read',
                { elementId: element.id },
              ),
            ]
          : [],
      );
    },
  },
  {
    id: 'image/alt',
    preset: 'accessibility',
    run(doc) {
      return doc.elements.flatMap((element, index) =>
        element.type === 'image' && !element.alt?.trim()
          ? [
              finding(
                this.id,
                this.preset,
                `elements.${index}.alt`,
                'image has no alternative text',
                { elementId: element.id },
              ),
            ]
          : [],
      );
    },
  },
  {
    id: 'layout/no-overlap',
    preset: 'recommended',
    run(doc) {
      const members = new Set(doc.layouts.flatMap(({ elementIds }) => elementIds));
      const boxes = doc.elements
        .filter(({ id }) => members.has(id))
        .map((element) => ({ element, box: measureElementBox(element) }))
        .filter(
          (item): item is { element: typeof item.element; box: NonNullable<typeof item.box> } =>
            item.box !== null,
        );
      const issues: LintFinding[] = [];
      for (let first = 0; first < boxes.length; first += 1)
        for (let second = first + 1; second < boxes.length; second += 1) {
          const a = boxes[first]!,
            b = boxes[second]!;
          if (
            a.box.x < b.box.x + b.box.width &&
            a.box.x + a.box.width > b.box.x &&
            a.box.y < b.box.y + b.box.height &&
            a.box.y + a.box.height > b.box.y
          )
            issues.push(
              finding(
                this.id,
                this.preset,
                'layouts',
                `elements "${a.element.id}" and "${b.element.id}" overlap`,
                { elementId: a.element.id },
              ),
            );
        }
      return issues;
    },
  },
  {
    id: 'connector/no-self-loop',
    preset: 'correctness',
    run(doc) {
      return doc.elements.flatMap((element, index) =>
        (element.type === 'line' || element.type === 'arrow') &&
        element.fromId &&
        element.fromId === element.toId
          ? [
              finding(
                this.id,
                this.preset,
                `elements.${index}`,
                'connector starts and ends at the same element',
                { elementId: element.id },
              ),
            ]
          : [],
      );
    },
  },
];

export function lintDocument(
  document: AnimationDocument,
  options: LintOptions = {},
): LintFinding[] {
  const presets = new Set(options.presets ?? ['correctness', 'accessibility', 'recommended']);
  const disabled = new Set(options.disabledRules ?? []);
  return [...BUILTIN_RULES, ...(options.rules ?? [])]
    .filter((rule) => presets.has(rule.preset) && !disabled.has(rule.id))
    .flatMap((rule) => rule.run(document))
    .map((item) => Object.freeze(item));
}

export function autofixDocument(
  document: AnimationDocument,
  options: LintOptions = {},
): {
  document: AnimationDocument;
  fixes: readonly LintFinding[];
  remaining: readonly LintFinding[];
} {
  const rules = [...BUILTIN_RULES, ...(options.rules ?? [])];
  let next = structuredClone(document);
  const fixes: LintFinding[] = [];
  for (const issue of lintDocument(next, options)) {
    const rule = rules.find(({ id }) => id === issue.ruleId);
    if (!issue.fixable || !rule?.fix) continue;
    next = rule.fix(next, issue);
    fixes.push(issue);
  }
  return { document: next, fixes, remaining: lintDocument(next, options) };
}
