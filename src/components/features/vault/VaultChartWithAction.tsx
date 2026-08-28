import type { ReactNode } from 'react';

/** Desktop: chart/panel on the left, compact Deposit/Withdraw card on the right. */
export function VaultChartWithAction({
  action,
  children,
}: {
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className={`flex flex-col gap-3 ${
        action ? 'md:flex-row md:items-stretch md:gap-4' : ''
      }`}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {action ? (
        <aside className="hidden md:flex md:w-56 lg:w-64 shrink-0">{action}</aside>
      ) : null}
    </div>
  );
}
