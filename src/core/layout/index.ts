import type { AnimationDocument } from '../schema/document';
import type { AnimationElement } from '../schema/elements';
import type { Layout, LayoutConstraint } from '../schema/layout';
import { estimateTextWidth, type TextMeasurer } from '../text/width';

export interface LayoutBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface LayoutFinding {
  readonly severity: 'warning' | 'error';
  readonly code: 'missing-element' | 'unsupported-element' | 'duplicate-membership';
  readonly layoutId: string;
  readonly elementId: string;
  readonly message: string;
}

export interface CompileLayoutOptions {
  readonly textMeasurer?: TextMeasurer;
}

export interface CompileLayoutResult {
  readonly document: AnimationDocument;
  readonly findings: readonly LayoutFinding[];
  readonly boxes: Readonly<Record<string, LayoutBox>>;
}

function parsePoints(points: string): readonly [number, number][] {
  const values = points
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (values.some((value) => !Number.isFinite(value)) || values.length < 2) return [];
  const result: [number, number][] = [];
  for (let index = 0; index + 1 < values.length; index += 2) {
    result.push([values[index]!, values[index + 1]!]);
  }
  return result;
}

/** Measure the authoring box before placement. Hosts may supply exact font metrics. */
export function measureElementBox(
  element: AnimationElement,
  options: CompileLayoutOptions = {},
): LayoutBox | null {
  switch (element.type) {
    case 'rect':
    case 'image':
    case 'code':
      return { x: element.x, y: element.y, width: element.width, height: element.height };
    case 'circle':
      return {
        x: element.cx - element.r,
        y: element.cy - element.r,
        width: element.r * 2,
        height: element.r * 2,
      };
    case 'text': {
      const width = estimateTextWidth(element.content, element.fontSize, {
        measurer: options.textMeasurer,
      });
      const x =
        element.textAnchor === 'middle'
          ? element.x - width / 2
          : element.textAnchor === 'end'
            ? element.x - width
            : element.x;
      return { x, y: element.y - element.fontSize, width, height: element.fontSize * 1.2 };
    }
    case 'group':
      return { x: element.x, y: element.y, width: 0, height: 0 };
    case 'polygon': {
      const points = parsePoints(element.points);
      if (points.length === 0) return null;
      const xs = points.map(([x]) => x);
      const ys = points.map(([, y]) => y);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
    }
    case 'line':
    case 'arrow': {
      if ([element.x1, element.y1, element.x2, element.y2].some((value) => value === undefined))
        return null;
      const x = Math.min(element.x1!, element.x2!);
      const y = Math.min(element.y1!, element.y2!);
      return {
        x,
        y,
        width: Math.abs(element.x2! - element.x1!),
        height: Math.abs(element.y2! - element.y1!),
      };
    }
    case 'path':
      return null;
  }
}

function moveElement(element: AnimationElement, x: number, y: number, box: LayoutBox): void {
  const dx = x - box.x;
  const dy = y - box.y;
  switch (element.type) {
    case 'rect':
    case 'image':
    case 'code':
    case 'text':
    case 'group':
    case 'path':
      element.x += dx;
      element.y += dy;
      break;
    case 'circle':
      element.cx += dx;
      element.cy += dy;
      break;
    case 'line':
    case 'arrow':
      if (element.x1 !== undefined) element.x1 += dx;
      if (element.y1 !== undefined) element.y1 += dy;
      if (element.x2 !== undefined) element.x2 += dx;
      if (element.y2 !== undefined) element.y2 += dy;
      break;
    case 'polygon':
      element.points = parsePoints(element.points)
        .map(([px, py]) => `${px + dx},${py + dy}`)
        .join(' ');
      break;
  }
}

function alignmentOffset(container: number, item: number, align: Layout['align']): number {
  if (align === 'center') return (container - item) / 2;
  if (align === 'end') return container - item;
  return 0;
}

function arrange(
  layout: Layout,
  entries: readonly { element: AnimationElement; box: LayoutBox }[],
): void {
  const rowGap = layout.rowGap ?? layout.gap;
  const columnGap = layout.columnGap ?? layout.gap;
  if (layout.mode === 'row') {
    const height = layout.height ?? Math.max(...entries.map(({ box }) => box.height));
    let x = layout.x;
    for (const { element, box } of entries) {
      moveElement(element, x, layout.y + alignmentOffset(height, box.height, layout.align), box);
      x += box.width + columnGap;
    }
    return;
  }
  if (layout.mode === 'column') {
    const width = layout.width ?? Math.max(...entries.map(({ box }) => box.width));
    let y = layout.y;
    for (const { element, box } of entries) {
      moveElement(element, layout.x + alignmentOffset(width, box.width, layout.align), y, box);
      y += box.height + rowGap;
    }
    return;
  }

  const columns = layout.columns ?? Math.ceil(Math.sqrt(entries.length));
  const columnWidths = Array.from({ length: columns }, () => 0);
  const rowHeights = Array.from({ length: Math.ceil(entries.length / columns) }, () => 0);
  entries.forEach(({ box }, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    columnWidths[column] = Math.max(columnWidths[column]!, box.width);
    rowHeights[row] = Math.max(rowHeights[row]!, box.height);
  });
  entries.forEach(({ element, box }, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x =
      layout.x + columnWidths.slice(0, column).reduce((sum, width) => sum + width + columnGap, 0);
    const y = layout.y + rowHeights.slice(0, row).reduce((sum, height) => sum + height + rowGap, 0);
    moveElement(
      element,
      x + alignmentOffset(columnWidths[column]!, box.width, layout.align),
      y,
      box,
    );
  });
}

function edge(
  box: LayoutBox,
  axis: 'x' | 'y',
  value: LayoutConstraint & { type: 'align' },
): number {
  const start = axis === 'x' ? box.x : box.y;
  const size = axis === 'x' ? box.width : box.height;
  if (value.edge === 'center') return start + size / 2;
  if (value.edge === 'end') return start + size;
  return start;
}

/** Resolve layout declarations in document order and return a coordinate-frozen document. */
export function compileLayouts(
  input: AnimationDocument,
  options: CompileLayoutOptions = {},
): CompileLayoutResult {
  const compiledDocument = structuredClone(input);
  const findings: LayoutFinding[] = [];
  const elements = new Map(compiledDocument.elements.map((element) => [element.id, element]));
  const membership = new Set<string>();

  const boxOf = (elementId: string): LayoutBox | null => {
    const element = elements.get(elementId);
    return element ? measureElementBox(element, options) : null;
  };
  const move = (elementId: string, x: number, y: number): void => {
    const element = elements.get(elementId);
    const box = boxOf(elementId);
    if (element && box) moveElement(element, x, y, box);
  };

  for (const layout of compiledDocument.layouts) {
    const entries: { element: AnimationElement; box: LayoutBox }[] = [];
    for (const elementId of layout.elementIds) {
      if (membership.has(elementId)) {
        findings.push({
          severity: 'error',
          code: 'duplicate-membership',
          layoutId: layout.id,
          elementId,
          message: `요소 ${elementId}가 둘 이상의 layout에 포함되어 있습니다.`,
        });
        continue;
      }
      const element = elements.get(elementId);
      if (!element) {
        findings.push({
          severity: 'error',
          code: 'missing-element',
          layoutId: layout.id,
          elementId,
          message: `요소 ${elementId}를 찾을 수 없습니다.`,
        });
        continue;
      }
      const box = measureElementBox(element, options);
      if (!box) {
        findings.push({
          severity: 'warning',
          code: 'unsupported-element',
          layoutId: layout.id,
          elementId,
          message: `요소 ${elementId}의 크기를 결정할 수 없어 layout에서 제외했습니다.`,
        });
        continue;
      }
      membership.add(elementId);
      entries.push({ element, box });
    }
    if (entries.length > 0) arrange(layout, entries);

    for (const constraint of layout.constraints) {
      if (constraint.type === 'rightOf' || constraint.type === 'below') {
        const target = boxOf(constraint.targetId);
        const current = boxOf(constraint.elementId);
        if (!target || !current) continue;
        move(
          constraint.elementId,
          constraint.type === 'rightOf' ? target.x + target.width + constraint.gap : current.x,
          constraint.type === 'below' ? target.y + target.height + constraint.gap : current.y,
        );
      } else if (constraint.type === 'sameX' || constraint.type === 'sameY') {
        const target = boxOf(constraint.targetId);
        const current = boxOf(constraint.elementId);
        if (!target || !current) continue;
        move(
          constraint.elementId,
          constraint.type === 'sameX' ? target.x : current.x,
          constraint.type === 'sameY' ? target.y : current.y,
        );
      } else if (constraint.type === 'align') {
        const boxes = constraint.elementIds
          .map((id) => ({ id, box: boxOf(id) }))
          .filter((entry): entry is { id: string; box: LayoutBox } => entry.box !== null);
        const reference = boxes[0];
        if (!reference) continue;
        const targetEdge = edge(reference.box, constraint.axis, constraint);
        for (const entry of boxes.slice(1)) {
          const delta = targetEdge - edge(entry.box, constraint.axis, constraint);
          move(
            entry.id,
            entry.box.x + (constraint.axis === 'x' ? delta : 0),
            entry.box.y + (constraint.axis === 'y' ? delta : 0),
          );
        }
      } else if (constraint.type === 'contain') {
        const container = boxOf(constraint.containerId);
        const current = boxOf(constraint.elementId);
        if (!container || !current) continue;
        const maxX = container.x + container.width - constraint.padding - current.width;
        const maxY = container.y + container.height - constraint.padding - current.height;
        move(
          constraint.elementId,
          Math.min(Math.max(current.x, container.x + constraint.padding), maxX),
          Math.min(Math.max(current.y, container.y + constraint.padding), maxY),
        );
      } else {
        const first = boxOf(constraint.firstId);
        const second = boxOf(constraint.secondId);
        if (!first || !second) continue;
        if (constraint.axis === 'x')
          move(
            constraint.secondId,
            Math.max(second.x, first.x + first.width + constraint.gap),
            second.y,
          );
        else
          move(
            constraint.secondId,
            second.x,
            Math.max(second.y, first.y + first.height + constraint.gap),
          );
      }
    }
  }

  const boxes = Object.fromEntries(
    compiledDocument.elements.flatMap((element) => {
      const box = measureElementBox(element, options);
      return box ? [[element.id, box] as const] : [];
    }),
  );
  return { document: compiledDocument, findings, boxes };
}
