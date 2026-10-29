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
