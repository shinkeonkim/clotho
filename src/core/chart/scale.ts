// Scales: data values to canvas positions.
//
// A deliberate re-implementation of the small part of d3-scale that an
// explanatory chart needs, rather than a dependency. Two reasons. The core takes
// no dependency it cannot justify at every entry point, and what is needed here is
// perhaps two hundred lines of arithmetic — `nice`, `ticks`, and a linear map —
// against a package that brings interpolators, time scales, and colour spaces this
// will never call.
//
// Everything here is pure and total: an empty domain, a zero-width range and a
// degenerate single-value domain all produce a usable scale rather than NaN, which
// is what keeps a chart of one data point from rendering as nothing.

export interface LinearScale {
  readonly kind: 'linear';
  readonly domain: readonly [number, number];
  readonly range: readonly [number, number];
  /** Value → position. */
  scale(value: number): number;
  /** Position → value, for hit testing and annotation anchoring. */
  invert(position: number): number;
  ticks(count: number): number[];
}

export interface BandScale {
  readonly kind: 'band';
  readonly domain: readonly string[];
  readonly range: readonly [number, number];
  /** The width of one band, after padding. */
  readonly bandwidth: number;
  /** Category → the band's start position. */
  scale(value: string): number;
  /** Category → the band's center, which is where a point or label goes. */
  center(value: string): number;
  ticks(): string[];
}

export type Scale = LinearScale | BandScale;

/**
 * Round a domain outward to values a reader can name.
 *
 * `[0, 4823]` becomes `[0, 5000]`, so the axis is labelled in fives rather than in
 * whatever the largest sample happened to be. The step is chosen from 1, 2, 5, 10 ×
 * a power of ten — the same family d3 uses, and the same family people use when
 * drawing an axis by hand.
 */
export function niceDomain(min: number, max: number, count = 5): readonly [number, number] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) {
    // A single value still needs a range to sit in; centre it in one unit.
    const magnitude = Math.abs(min) || 1;
    return [min - magnitude * 0.5, max + magnitude * 0.5];
  }

  // Iterated to a fixed point, because widening the domain can change which step
  // `tickStep` chooses — and if the two disagree, the axis ends before its own last
  // tick. Bounded, since a pathological input must not spin.
  let low = min;
  let high = max;
  for (let i = 0; i < 4; i += 1) {
    const step = tickStep(low, high, count);
    const nextLow = Math.floor(low / step) * step;
    const nextHigh = Math.ceil(high / step) * step;
    if (nextLow === low && nextHigh === high) break;
    low = nextLow;
    high = nextHigh;
  }
  return [low, high];
}

/**
 * The 1/2/5×10ⁿ step that divides `[min, max]` into roughly `count` intervals.
 *
 * The thresholds are geometric means — √50, √10, √2 — rather than the arithmetic
 * midpoints one might reach for. Choosing between a step of 2 and a step of 5 is a
 * choice between ratios, so the fair boundary is √10, not 3.5. It also happens to be
 * what d3 uses, which matters here: an axis nicened with one rule and ticked with
 * another ends before its own last tick.
 */
const E10 = Math.sqrt(50);
const E5 = Math.sqrt(10);
const E2 = Math.sqrt(2);

export function tickStep(min: number, max: number, count: number): number {
  const span = Math.abs(max - min) || 1;
  const rough = span / Math.max(1, count);
  const power = Math.pow(10, Math.floor(Math.log10(rough)));
  const normalized = rough / power;
  const factor = normalized >= E10 ? 10 : normalized >= E5 ? 5 : normalized >= E2 ? 2 : 1;
  return factor * power;
}

/** Round to a sane number of decimals so 0.30000000000000004 never reaches an axis. */
function tidy(value: number, step: number): number {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  const rounded = Number(value.toFixed(Math.min(decimals, 12)));
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function linearScale(
  domain: readonly [number, number],
  range: readonly [number, number],
): LinearScale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;

  return {
    kind: 'linear',
    domain,
    range,
    scale(value) {
      if (!Number.isFinite(value)) return r0;
      // A zero-width domain maps everything to the middle rather than to infinity.
      if (span === 0) return (r0 + r1) / 2;
      return r0 + ((value - d0) / span) * (r1 - r0);
    },
    invert(position) {
      if (r1 === r0) return d0;
      return d0 + ((position - r0) / (r1 - r0)) * span;
    },
    ticks(count) {
      if (span === 0) return [d0];
      const step = tickStep(d0, d1, count);
      const start = Math.ceil(Math.min(d0, d1) / step) * step;
      const end = Math.max(d0, d1);
      const out: number[] = [];
      // Guarded rather than while(true): a pathological step would otherwise spin.
      for (
        let value = start, i = 0;
        value <= end + step * 1e-9 && i < 1000;
        value += step, i += 1
      ) {
        out.push(tidy(value, step));
      }
      return out;
    },
  };
}

/**
 * Evenly spaced categories, with padding expressed as a fraction of the step.
 *
 * `padding: 0.2` means a fifth of each slot is gap, which is how bar charts are
 * usually specified and avoids the author having to compute widths.
 */
export function bandScale(
  domain: readonly string[],
  range: readonly [number, number],
  padding = 0,
): BandScale {
  const [r0, r1] = range;
  const count = Math.max(1, domain.length);
  const clampedPadding = Math.min(Math.max(padding, 0), 0.99);
  const step = (r1 - r0) / count;
  const bandwidth = step * (1 - clampedPadding);
  const offset = (step - bandwidth) / 2;
  const index = new Map(domain.map((value, i) => [value, i]));

  return {
    kind: 'band',
    domain,
    range,
    bandwidth,
    scale(value) {
      const i = index.get(value);
      if (i === undefined) return r0;
      return r0 + i * step + offset;
    },
    center(value) {
      return this.scale(value) + bandwidth / 2;
    },
    ticks() {
      return [...domain];
    },
  };
}

/** Smallest and largest finite value, or null when there are none. */
export function extent(values: readonly number[]): readonly [number, number] | null {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return min === Infinity ? null : [min, max];
}
