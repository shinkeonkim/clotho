// The id convention a compiled chart produces.
//
// This is the whole public contract of the chart compiler. A chart is not a new
// renderer — it is a generator of ordinary primitives whose ids are predictable —
// and that is what lets every existing feature address a chart's parts with no new
// syntax:
//
//   { "type": "pulse", "elementId": "bench__series-quick__point-3" }
//   { "type": "spotlight", "elementIds": ["bench__series-quick"] }
//   { "camera": { "focus": [{ "elementIds": ["bench__axis-y"] }] } }
//
// The separator is `__` rather than the `/` the proposal sketched, because element
// ids are `^[a-z0-9][a-z0-9_-]*$` and widening that regex is a decision bound up
// with 383 existing documents and the migration path. `__` reads as a path
// separator inside the rule that already exists.

/** Separator between path segments of a generated id. */
export const ID_SEPARATOR = '__';

/**
 * Make a series or category name safe to appear in an id.
 *
 * Lowercased, non-id characters collapsed to `-`, and `__` broken up so a slug can
 * never forge a path segment. An empty result becomes `x`, since an id segment must
 * not be empty.
 */
export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/_{2,}/g, '_')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'x' : slug;
}

const join = (...parts: string[]): string => parts.join(ID_SEPARATOR);

export const chartIds = {
  /** The plot frame and grid. */
  plot: (chartId: string): string => join(chartId, 'plot'),
  grid: (chartId: string, axis: 'x' | 'y', index: number): string =>
    join(chartId, `grid-${axis}`, `line-${index}`),
  axis: (chartId: string, axis: 'x' | 'y'): string => join(chartId, `axis-${axis}`),
  axisLabel: (chartId: string, axis: 'x' | 'y'): string => join(chartId, `axis-${axis}`, 'label'),
  tick: (chartId: string, axis: 'x' | 'y', index: number): string =>
    join(chartId, `axis-${axis}`, `tick-${index}`),
  tickLabel: (chartId: string, axis: 'x' | 'y', index: number): string =>
    join(chartId, `axis-${axis}`, `tick-${index}`, 'label'),
  series: (chartId: string, series: string): string => join(chartId, `series-${slugify(series)}`),
  point: (chartId: string, series: string, index: number): string =>
    join(chartId, `series-${slugify(series)}`, `point-${index}`),
  legend: (chartId: string, series: string): string => join(chartId, 'legend', slugify(series)),
} as const;

/** True when `id` was generated for `chartId`, used to replace a chart's output. */
export function belongsToChart(id: string, chartId: string): boolean {
  return id === chartId || id.startsWith(`${chartId}${ID_SEPARATOR}`);
}
