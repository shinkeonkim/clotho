// The chart compiler: a spec in, ordinary v1 elements out.
//
// Nothing here runs at render time. `compileCharts` is called by an author, a build
// step or an editor, and what it returns is a document containing rects, lines,
// paths and texts that the runtime has always known how to draw. The renderer never
// learns that charts exist.
//
// The compiler's contract is the id convention in ./ids.ts, not the pixels. Two
// charts drawn slightly differently are a cosmetic change; an id that moves breaks
// somebody's `pulse`.

import type { AnimationDocument } from '../schema/document';
import type { AnimationElement } from '../schema/elements';
import type { Chart, RevealSpec } from '../schema/chart';
import type { Appearance, PropertyTrack } from '../schema/primitives';
import { estimateTextWidth, type TextMeasurer } from '../text/width';
import {
  bandScale,
  extent,
  linearScale,
  niceDomain,
  type BandScale,
  type LinearScale,
} from './scale';
import { belongsToChart, chartIds } from './ids';

export interface ChartFinding {
  readonly severity: 'warning' | 'error';
  readonly code: 'empty-data' | 'unknown-field' | 'non-numeric' | 'duplicate-id' | 'label-crowding';
  readonly chartId: string;
  readonly message: string;
}

export interface CompileChartsOptions {
  readonly textMeasurer?: TextMeasurer;
}

export interface CompileChartsResult {
  readonly document: AnimationDocument;
  readonly findings: readonly ChartFinding[];
}

/** Colors used when a chart names no palette. Distinguishable in both themes. */
const DEFAULT_PALETTE = ['#6366f1', '#f97316', '#16a34a', '#db2777', '#0ea5e9', '#a855f7'];

const AXIS_COLOR = '#94a3b8';
const GRID_COLOR = '#e2e8f0';
const LABEL_SIZE = 12;
/** Space reserved below and to the left of the plot for tick labels and axis names. */
const AXIS_GUTTER = { bottom: 34, left: 44 } as const;

interface Row {
  readonly category: string;
  readonly value: number;
  readonly series: string;
  readonly index: number;
}

function readCell(row: Record<string, unknown>, field: string): unknown {
  return row[field];
}

function asLabel(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

/** Rows in document order, with anything unusable reported rather than dropped silently. */
function readRows(chart: Chart, findings: ChartFinding[]): Row[] {
  const rows: Row[] = [];
  chart.data.forEach((raw, index) => {
    const record = raw as Record<string, unknown>;
    if (!(chart.encode.x in record)) {
      findings.push({
        severity: 'warning',
        code: 'unknown-field',
        chartId: chart.id,
        message: `row ${index} has no "${chart.encode.x}" field`,
      });
    }
    const rawValue = readCell(record, chart.encode.y);
    const value = typeof rawValue === 'number' ? rawValue : Number(rawValue);
    if (!Number.isFinite(value)) {
      findings.push({
        severity: 'warning',
        code: 'non-numeric',
        chartId: chart.id,
        message: `row ${index} has a non-numeric "${chart.encode.y}": ${JSON.stringify(rawValue)}`,
      });
      return;
    }
    rows.push({
      category: asLabel(readCell(record, chart.encode.x)),
      value,
      series: chart.encode.series ? asLabel(readCell(record, chart.encode.series)) : 'value',
      index,
    });
  });
  return rows;
}

/** Distinct values in first-seen order, which is the order the author wrote them. */
function distinct(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

interface Frame {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

function plotFrame(chart: Chart): Frame {
  return {
    left: chart.x + AXIS_GUTTER.left,
    right: chart.x + chart.width,
    top: chart.y,
    bottom: chart.y + chart.height - AXIS_GUTTER.bottom,
  };
}

/** Appearance windows applied to every element the chart produces. */
function appearancesFor(chart: Chart, doc: AnimationDocument): Appearance[] {
  const phase = chart.appearance ?? { start: 0, end: doc.duration };
  return [{ ...phase, entryDuration: 0, exitDuration: 0 }];
}

function track(property: string, keyframes: PropertyTrack['keyframes']): PropertyTrack {
  return { property, keyframes };
}

/**
 * The reveal phase for item `i`, or null when nothing should animate.
 *
 * Staggering is what makes a series read as "one after another" rather than as a
 * single simultaneous jump, and it is the only place the reveal spec needs the item
 * index at all.
 */
function revealWindow(reveal: RevealSpec, i: number): { from: number; to: number } | null {
  if (reveal.mode === 'none' || reveal.duration <= 0) return null;
  const from = reveal.start + reveal.stagger * i;
  return { from, to: from + reveal.duration };
}

export function compileCharts(
  input: AnimationDocument,
  options: CompileChartsOptions = {},
): CompileChartsResult {
  if (input.charts.length === 0) return { document: input, findings: [] };

  const findings: ChartFinding[] = [];
  const compiled = structuredClone(input);
  const produced: AnimationElement[] = [];

  for (const chart of compiled.charts) {
    produced.push(...compileOne(chart, compiled, options, findings));
  }

  // A chart's previous output is replaced rather than added to, so compiling twice
  // is the same as compiling once — an editor calls this on every keystroke.
  const chartIdsInPlay = compiled.charts.map((chart) => chart.id);
  const kept = compiled.elements.filter(
    (element) => !chartIdsInPlay.some((chartId) => belongsToChart(element.id, chartId)),
  );

  const existing = new Set(kept.map((element) => element.id));
  for (const element of produced) {
    if (!existing.has(element.id)) continue;
    findings.push({
      severity: 'error',
      code: 'duplicate-id',
      chartId: element.id,
      message: `generated id "${element.id}" collides with an authored element`,
    });
  }

  return { document: { ...compiled, elements: [...kept, ...produced] }, findings };
}

function compileOne(
  chart: Chart,
  doc: AnimationDocument,
  options: CompileChartsOptions,
  findings: ChartFinding[],
): AnimationElement[] {
  const rows = readRows(chart, findings);
  if (rows.length === 0) {
    findings.push({
      severity: 'warning',
      code: 'empty-data',
      chartId: chart.id,
      message: `chart "${chart.id}" has no usable rows`,
    });
    return [];
  }

  const frame = plotFrame(chart);
  const appearances = appearancesFor(chart, doc);
  const categories = distinct(rows.map((row) => row.category));
  const seriesNames = distinct(rows.map((row) => row.series));
  const palette = chart.palette.length > 0 ? chart.palette : DEFAULT_PALETTE;

  const xSpec =
    chart.scale.x ?? (chart.kind === 'bar' ? { type: 'band' as const, padding: 0.2 } : undefined);
  const x =
    xSpec?.type === 'band' || chart.kind === 'bar'
      ? bandScale(
          categories,
          [frame.left, frame.right],
          xSpec?.type === 'band' ? xSpec.padding : 0.2,
        )
      : linearScale(
          resolveDomain(
            chart,
            rows.map((row) => Number(row.category)),
            'x',
          ),
          [frame.left, frame.right],
        );
  const y = linearScale(
    resolveDomain(
      chart,
      rows.map((row) => row.value),
      'y',
    ),
    // Inverted: the canvas grows downward and a value axis grows upward.
    [frame.bottom, frame.top],
  );

  const elements: AnimationElement[] = [
    plotElement(chart, frame, appearances),
    ...gridElements(chart, frame, y, appearances),
    ...axisElements(chart, frame, x, y, appearances, options, findings),
    ...(chart.kind === 'bar'
      ? barElements(chart, rows, seriesNames, x as BandScale, y, frame, palette, appearances)
      : lineElements(chart, rows, seriesNames, x, y, palette, appearances)),
    ...(chart.legend ? legendElements(chart, seriesNames, palette, appearances) : []),
  ];

  return elements;
}

function resolveDomain(
  chart: Chart,
  values: readonly number[],
  axis: 'x' | 'y',
): readonly [number, number] {
  const spec = chart.scale[axis];
  const measured = extent(values.filter((value) => Number.isFinite(value))) ?? [0, 1];
  if (spec?.type !== 'linear') {
    // A bar chart's value axis starts at zero, because bar length is the encoding
    // and a truncated axis makes the lengths lie.
    const base: readonly [number, number] =
      chart.kind === 'bar' && axis === 'y'
        ? [Math.min(0, measured[0]), Math.max(0, measured[1])]
        : measured;
    return niceDomain(base[0], base[1]);
  }

  const low = spec.domain?.[0];
  const high = spec.domain?.[1];
  const resolved: [number, number] = [
    typeof low === 'number'
      ? low
      : chart.kind === 'bar' && axis === 'y'
        ? Math.min(0, measured[0])
        : measured[0],
    typeof high === 'number' ? high : measured[1],
  ];
  return spec.nice ? niceDomain(resolved[0], resolved[1]) : resolved;
}

/**
 * An invisible rect covering the plot area.
 *
 * It draws nothing, which is the point: it exists so that "the plot" is addressable.
 * `camera.focus` on `bench__plot` frames the data region without the axis labels,
 * and a spotlight on it dims everything outside the chart. Without it the only way
 * to name that rectangle would be to list every element inside it.
 */
function plotElement(chart: Chart, frame: Frame, appearances: Appearance[]): AnimationElement {
  return {
    type: 'rect',
    id: chartIds.plot(chart.id),
    x: frame.left,
    y: frame.top,
    width: Math.max(frame.right - frame.left, 0.01),
    height: Math.max(frame.bottom - frame.top, 0.01),
    fill: 'none',
    stroke: 'none',
    strokeWidth: 0,
    cornerRadius: 0,
    labelColor: '#0b0b0f',
    labelSize: 14,
    rotation: 0,
    appearances,
    tracks: [],
    bindings: [],
  };
}

function gridElements(
  chart: Chart,
  frame: Frame,
  y: LinearScale,
  appearances: Appearance[],
): AnimationElement[] {
  if (!chart.axes.y.grid) return [];
  return y.ticks(chart.axes.y.ticks).map((value, index) => ({
    type: 'line' as const,
    id: chartIds.grid(chart.id, 'y', index),
    x1: frame.left,
    y1: y.scale(value),
    x2: frame.right,
    y2: y.scale(value),
    stroke: GRID_COLOR,
    strokeWidth: 1,
    rotation: 0,
    appearances,
    tracks: [],
    bindings: [],
  }));
}

function axisElements(
  chart: Chart,
  frame: Frame,
  x: LinearScale | BandScale,
  y: LinearScale,
  appearances: Appearance[],
  options: CompileChartsOptions,
  findings: ChartFinding[],
): AnimationElement[] {
  const out: AnimationElement[] = [];
  const base = { rotation: 0, appearances, tracks: [], bindings: [] };

  if (!chart.axes.x.hidden) {
    out.push({
      type: 'line',
      id: chartIds.axis(chart.id, 'x'),
      x1: frame.left,
      y1: frame.bottom,
      x2: frame.right,
      y2: frame.bottom,
      stroke: AXIS_COLOR,
      strokeWidth: 1.5,
      ...base,
    });
  }
  if (!chart.axes.y.hidden) {
    out.push({
      type: 'line',
      id: chartIds.axis(chart.id, 'y'),
      x1: frame.left,
      y1: frame.top,
      x2: frame.left,
      y2: frame.bottom,
      stroke: AXIS_COLOR,
      strokeWidth: 1.5,
      ...base,
    });
  }

  // X tick labels. Thinned rather than overlapped: an axis whose labels collide is
  // less readable than one that names every other category.
  const xLabels = x.kind === 'band' ? x.ticks() : x.ticks(chart.axes.x.ticks).map(String);
  const widest = Math.max(
    ...xLabels.map((label) =>
      estimateTextWidth(label, LABEL_SIZE, { measurer: options.textMeasurer }),
    ),
    1,
  );
  const available = (frame.right - frame.left) / Math.max(1, xLabels.length);
  const stride = Math.max(1, Math.ceil((widest + 6) / Math.max(available, 1)));
  if (stride > 1) {
    findings.push({
      severity: 'warning',
      code: 'label-crowding',
      chartId: chart.id,
      message: `x tick labels would overlap; showing every ${stride}th`,
    });
  }

  if (!chart.axes.x.hidden) {
    xLabels.forEach((label, index) => {
      if (index % stride !== 0) return;
      const position = x.kind === 'band' ? x.center(label) : x.scale(Number(label));
      out.push({
        type: 'text',
        id: chartIds.tickLabel(chart.id, 'x', index),
        x: position,
        y: frame.bottom + 18,
        content: label,
        fontSize: LABEL_SIZE,
        textAnchor: 'middle',
        color: AXIS_COLOR,
        fontWeight: 400,
        translations: {},
        references: {},
        ...base,
      });
    });
  }

  if (!chart.axes.y.hidden) {
    y.ticks(chart.axes.y.ticks).forEach((value, index) => {
      out.push({
        type: 'text',
        id: chartIds.tickLabel(chart.id, 'y', index),
        x: frame.left - 8,
        y: y.scale(value) + 4,
        content: String(value),
        fontSize: LABEL_SIZE,
        textAnchor: 'end',
        color: AXIS_COLOR,
        fontWeight: 400,
        translations: {},
        references: {},
        ...base,
      });
    });
  }

  for (const axis of ['x', 'y'] as const) {
    const spec = chart.axes[axis];
    if (spec.label === '') continue;
    out.push({
      type: 'text',
      id: chartIds.axisLabel(chart.id, axis),
      x: axis === 'x' ? (frame.left + frame.right) / 2 : chart.x + 12,
      y: axis === 'x' ? chart.y + chart.height : (frame.top + frame.bottom) / 2,
      content: spec.label,
      fontSize: LABEL_SIZE + 1,
      textAnchor: 'middle',
      color: AXIS_COLOR,
      fontWeight: 600,
      rotation: axis === 'y' ? -90 : 0,
      appearances,
      tracks: [],
      bindings: [],
      translations: {},
      references: {},
    });
  }

  return out;
}

function barElements(
  chart: Chart,
  rows: readonly Row[],
  seriesNames: readonly string[],
  x: BandScale,
  y: LinearScale,
  frame: Frame,
  palette: readonly string[],
  appearances: Appearance[],
): AnimationElement[] {
  const zero = y.scale(Math.max(y.domain[0], Math.min(0, y.domain[1])));
  const perSeries = x.bandwidth / Math.max(1, seriesNames.length);

  return rows.map((row, order) => {
    const seriesIndex = Math.max(0, seriesNames.indexOf(row.series));
    const top = y.scale(row.value);
    const height = Math.abs(zero - top);
    const phase = revealWindow(chart.reveal, chart.reveal.mode === 'series' ? seriesIndex : order);
    const grows = chart.reveal.mode === 'grow' && phase !== null;

    const tracks: PropertyTrack[] = [];
    if (grows && phase) {
      // Growing means moving the top edge as the height changes; a rect is anchored
      // at its top-left, so both properties are animated together.
      tracks.push(
        track('height', [
          { time: phase.from, value: 0 },
          { time: phase.to, value: height, ease: chart.reveal.ease ?? 'easeOut' },
        ]),
        track('y', [
          { time: phase.from, value: zero },
          { time: phase.to, value: Math.min(zero, top), ease: chart.reveal.ease ?? 'easeOut' },
        ]),
      );
    }

    const revealed =
      chart.reveal.mode === 'series' && phase
        ? [{ ...appearances[0]!, start: Math.max(appearances[0]!.start, phase.from) }]
        : appearances;

    return {
      type: 'rect' as const,
      id: chartIds.point(chart.id, row.series, order),
      x: x.scale(row.category) + perSeries * seriesIndex,
      y: grows ? zero : Math.min(zero, top),
      width: Math.max(perSeries, 0.01),
      height: grows ? 0.01 : Math.max(height, 0.01),
      fill: palette[seriesIndex % palette.length]!,
      stroke: 'none',
      strokeWidth: 0,
      cornerRadius: 2,
      labelColor: '#0b0b0f',
      labelSize: 14,
      rotation: 0,
      appearances: revealed,
      tracks,
      bindings: [],
    };
  });
}

function lineElements(
  chart: Chart,
  rows: readonly Row[],
  seriesNames: readonly string[],
  x: LinearScale | BandScale,
  y: LinearScale,
  palette: readonly string[],
  appearances: Appearance[],
): AnimationElement[] {
  return seriesNames.map((series, seriesIndex) => {
    const points = rows.filter((row) => row.series === series);
    const d = points
      .map((row, i) => {
        const px = x.kind === 'band' ? x.center(row.category) : x.scale(Number(row.category));
        return `${i === 0 ? 'M' : 'L'} ${px} ${y.scale(row.value)}`;
      })
      .join(' ');

    const phase = revealWindow(chart.reveal, seriesIndex);
    const tracks: PropertyTrack[] = [];
    let dasharray: string | undefined;

    if (chart.reveal.mode === 'sweep' && phase) {
      // Length is estimated from the segment count rather than measured: the exact
      // path length needs a DOM, and the dash only has to exceed the true length for
      // the sweep to look right.
      const length = estimatePathLength(points, x, y);
      dasharray = `${length} ${length}`;
      tracks.push({
        property: 'strokeDashoffset',
        // Stated rather than inferred: a generated document should read as its own
        // documentation, and a reader should not have to know the classifier's
        // property list to see that this blends.
        interpolate: 'number',
        keyframes: [
          { time: phase.from, value: length },
          { time: phase.to, value: 0, ease: chart.reveal.ease ?? 'easeOut' },
        ],
      });
    }

    const revealed =
      chart.reveal.mode === 'series' && phase
        ? [{ ...appearances[0]!, start: Math.max(appearances[0]!.start, phase.from) }]
        : appearances;

    return {
      type: 'path' as const,
      id: chartIds.series(chart.id, series),
      x: 0,
      y: 0,
      d,
      fill: 'none',
      stroke: palette[seriesIndex % palette.length]!,
      strokeWidth: 2,
      strokeDasharray: dasharray,
      opacity: 1,
      rotation: 0,
      appearances: revealed,
      tracks,
      bindings: [],
    };
  });
}

function estimatePathLength(
  points: readonly Row[],
  x: LinearScale | BandScale,
  y: LinearScale,
): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const ax = x.kind === 'band' ? x.center(a.category) : x.scale(Number(a.category));
    const bx = x.kind === 'band' ? x.center(b.category) : x.scale(Number(b.category));
    total += Math.hypot(bx - ax, y.scale(b.value) - y.scale(a.value));
  }
  return Math.ceil(total) || 1;
}

function legendElements(
  chart: Chart,
  seriesNames: readonly string[],
  palette: readonly string[],
  appearances: Appearance[],
): AnimationElement[] {
  return seriesNames.map((series, index) => ({
    type: 'text' as const,
    id: chartIds.legend(chart.id, series),
    x: chart.x + chart.width,
    y: chart.y + 14 + index * 18,
    content: series,
    fontSize: LABEL_SIZE,
    textAnchor: 'end',
    color: palette[index % palette.length]!,
    fontWeight: 600,
    rotation: 0,
    appearances,
    tracks: [],
    bindings: [],
    translations: {},
    references: {},
  }));
}
