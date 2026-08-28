/** Visible rows before dashboard holding lists scroll. */
export const DASHBOARD_PANEL_VISIBLE_ROWS = 4;

/** Matches dashboard `gap-4` at the desktop split. */
export const DASHBOARD_GAP_PX = 16;

/** `min-[1000px]:h-[380px]` portfolio chart. */
export const DASHBOARD_CHART_DESKTOP_PX = 380;

/** Compact wallet strip (name + totals). */
export const DASHBOARD_WALLET_STRIP_PX = 80;

export type DashboardHoldingId = 'vaults' | 'cash' | 'crypto' | 'stocks';

export function estimateDashboardPanelHeight(rowCount: number): number {
  const header = 52;
  const tableHead = 36;
  const row = 56;
  const visible = Math.min(Math.max(rowCount, 1), DASHBOARD_PANEL_VISIBLE_ROWS);
  return header + tableHead + visible * row;
}

/**
 * Pack holdings into two desktop columns.
 * Left already has wallet+chart (or just the chart in wide mode).
 * Shorter Your Vaults leaves a gap on the right — the next box moves up into it.
 * Overflow continues under the chart.
 */
export function packDashboardHoldings(options: {
  leftBaseHeight: number;
  vaultCount: number;
  cashCount: number;
  cryptoCount: number;
  stockCount: number;
}): { left: DashboardHoldingId[]; right: DashboardHoldingId[] } {
  const left: DashboardHoldingId[] = [];
  const right: DashboardHoldingId[] = [];
  let leftH = options.leftBaseHeight;
  let rightH = 0;

  const queue: Array<{ id: DashboardHoldingId; height: number }> = [];
  if (options.vaultCount > 0) {
    queue.push({
      id: 'vaults',
      height: estimateDashboardPanelHeight(options.vaultCount),
    });
  }
  if (options.cashCount > 0) {
    queue.push({
      id: 'cash',
      height: estimateDashboardPanelHeight(options.cashCount),
    });
  }
  if (options.cryptoCount > 0) {
    queue.push({
      id: 'crypto',
      height: estimateDashboardPanelHeight(options.cryptoCount),
    });
  }
  if (options.stockCount > 0) {
    queue.push({
      id: 'stocks',
      height: estimateDashboardPanelHeight(options.stockCount),
    });
  }

  for (const item of queue) {
    if (right.length === 0) {
      right.push(item.id);
      rightH = item.height;
      continue;
    }

    const nextRight = rightH + DASHBOARD_GAP_PX + item.height;
    // Slack covers wallet-strip estimate error so a short vaults card still
    // pulls the next box up instead of leaving a hole.
    if (nextRight <= leftH + 24) {
      right.push(item.id);
      rightH = nextRight;
      continue;
    }

    left.push(item.id);
    leftH += DASHBOARD_GAP_PX + item.height;
  }

  return { left, right };
}
