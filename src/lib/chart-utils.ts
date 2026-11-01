export const VAULT_DETAIL_CHART_HEIGHT_CLASS =
  'h-52 sm:h-56 min-[1000px]:h-full min-[1000px]:min-h-[20rem]';
export const VAULT_DETAIL_CHART_MIN_HEIGHT = 208;

/** Recharts margin — left stays 0; YAxis `width` reserves label space. */
export const CHART_MARGIN = { top: 8, right: 12, bottom: 8, left: 0 } as const;

/** Pixel width for a Y-axis gutter so the longest tick, including "$", stays inside the chart. */
export function axisWidthForLabels(
  labels: readonly string[],
  { min = 48, max = 104 }: { min?: number; max?: number } = {}
): number {
  const longest = labels.reduce((width, label) => Math.max(width, label.length), 0);
  return Math.min(max, Math.max(min, longest * 8 + 8));
}

/** Ensure x-axis ticks include the first data point (fixes gap on "All" period). */
export function withLeadingChartTick(
  ticks: number[] | undefined,
  firstTimestamp: number | undefined
): number[] | undefined {
  if (!ticks || ticks.length === 0 || firstTimestamp == null) return ticks;
  if (ticks[0] === firstTimestamp) return ticks;
  return [firstTimestamp, ...ticks.filter((t) => t !== firstTimestamp)];
}

/**
 * Time-weighted average of a series (each point holds until the next one; the last point
 * holds for the interval before it). Skips non-finite values. `null` with no usable points.
 */
export function timeWeightedAverage(
  points: ReadonlyArray<{ timestamp: number; value: number }>
): number | null {
  const usable = points
    .filter((p) => Number.isFinite(p.timestamp) && Number.isFinite(p.value))
    .sort((a, b) => a.timestamp - b.timestamp);
  if (usable.length === 0) return null;
  if (usable.length === 1) return usable[0].value;
  let weighted = 0;
  let totalWeight = 0;
  for (let i = 0; i < usable.length; i++) {
    const next = usable[i + 1] ?? null;
    const weight = next
      ? next.timestamp - usable[i].timestamp
      : usable[i].timestamp - usable[i - 1].timestamp;
    weighted += usable[i].value * weight;
    totalWeight += weight;
  }
  if (totalWeight <= 0) {
    return usable.reduce((sum, p) => sum + p.value, 0) / usable.length;
  }
  return weighted / totalWeight;
}

const DAY_SECONDS = 24 * 60 * 60;
/** Tick steps in whole days; the smallest that fits `maxTicks` is used. */
const TICK_STEP_DAYS = [1, 2, 3, 7, 14, 30, 60, 90, 180, 365] as const;

/** Most x-axis date labels ("Mon 00") that fit a chart this many pixels wide. */
export function maxTimeTicksForWidth(widthPx: number, minLabelSpacingPx = 56): number {
  if (!Number.isFinite(widthPx) || widthPx <= 0) return 6;
  return Math.max(2, Math.min(12, Math.floor(widthPx / minLabelSpacingPx)));
}

/**
 * Evenly spaced x-axis ticks (unix seconds) between `start` and `end`: one every N calendar days
 * at local midnight, with N the smallest step that keeps the count at or under `maxTicks`.
 * Used with a numeric (time) axis, so equal steps are equal distances on screen.
 */
export function evenTimeTicks(start: number, end: number, maxTicks: number): number[] {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  const limit = Math.max(2, Math.floor(maxTicks));
  const spanDays = (end - start) / DAY_SECONDS;
  const stepDays =
    TICK_STEP_DAYS.find((step) => Math.floor(spanDays / step) + 1 <= limit) ??
    TICK_STEP_DAYS[TICK_STEP_DAYS.length - 1];

  // First local midnight at or after `start`; calendar-day steps keep labels on the right date
  // across daylight-saving changes.
  const cursor = new Date(start * 1000);
  cursor.setHours(0, 0, 0, 0);
  if (cursor.getTime() / 1000 < start) cursor.setDate(cursor.getDate() + 1);

  const ticks: number[] = [];
  while (cursor.getTime() / 1000 <= end) {
    ticks.push(Math.floor(cursor.getTime() / 1000));
    cursor.setDate(cursor.getDate() + stepDays);
  }
  return ticks;
}
