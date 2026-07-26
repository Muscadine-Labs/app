/** Recharts margin — left stays 0; YAxis `width` reserves label space. */
export const CHART_MARGIN = { top: 8, right: 12, bottom: 8, left: 0 } as const;

export function getChartYAxisWidth(kind: 'apy' | 'usd' | 'token' | 'tokenWide'): number {
  switch (kind) {
    case 'apy':
      return 56;
    case 'usd':
      return 72;
    case 'tokenWide':
      return 88;
    case 'token':
    default:
      return 80;
  }
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
