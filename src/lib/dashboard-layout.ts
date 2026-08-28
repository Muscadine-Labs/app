/** Visible rows before dashboard holding lists scroll. */
export const DASHBOARD_PANEL_VISIBLE_ROWS = 4;

/** Matches dashboard `gap-4` at the desktop split. */
export const DASHBOARD_GAP_PX = 16;

/** `min-[1000px]:h-[380px]` portfolio chart. */
export const DASHBOARD_CHART_DESKTOP_PX = 380;

/** Compact wallet strip (name + totals). */
export const DASHBOARD_WALLET_STRIP_PX = 80;

export type DashboardHoldingId = 'vaults' | 'tokens';

export function estimateDashboardPanelHeight(rowCount: number): number {
  const header = 52;
  const tableHead = 36;
  const row = 56;
  const visible = Math.min(Math.max(rowCount, 1), DASHBOARD_PANEL_VISIBLE_ROWS);
  return header + tableHead + visible * row;
}

/**
 * Pack holdings into two desktop columns.
 *
 * Your Vaults always starts on the right (beside the chart). Later boxes go
 * on the column that keeps overall page height shorter — so a 3-row Tokens
 * table sits under Your Vaults instead of under the chart while the side
 * column sits empty. Tokens only drop under the chart when the right column
 * is already the taller one.
 *
 * Mobile does not use this; it stacks wallet → chart → Vaults → Tokens.
 */
export function packDashboardHoldings(options: {
  leftBaseHeight: number;
  vaultCount: number;
  tokensCount: number;
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
  if (options.tokensCount > 0) {
    queue.push({
      id: 'tokens',
      height: estimateDashboardPanelHeight(options.tokensCount),
    });
  }

  for (const item of queue) {
    if (right.length === 0) {
      right.push(item.id);
      rightH = item.height;
      continue;
    }

    const nextRight = rightH + DASHBOARD_GAP_PX + item.height;
    const nextLeft = leftH + DASHBOARD_GAP_PX + item.height;
    const pageIfRight = Math.max(leftH, nextRight);
    const pageIfLeft = Math.max(nextLeft, rightH);

    // Tie → right, so Tokens fills under vaults instead of the chart.
    if (pageIfRight <= pageIfLeft) {
      right.push(item.id);
      rightH = nextRight;
    } else {
      left.push(item.id);
      leftH = nextLeft;
    }
  }

  return { left, right };
}
