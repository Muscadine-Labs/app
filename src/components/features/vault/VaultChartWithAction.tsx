import type { ReactNode } from 'react';

/**
 * Desktop (≥1000px): left column is status (header + chart), right column is
 * the transact panel, top-aligned. Below 1000px: header → chart → panel.
 */
export function VaultChartWithAction({
  action,
  header,
  children,
}: {
  action?: ReactNode;
  header?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className={`flex flex-col gap-4 ${
        action ? 'min-[1000px]:flex-row min-[1000px]:items-start min-[1000px]:gap-5' : ''
      }`}
    >
      <div className="min-w-0 flex-1 flex flex-col gap-4">
        {header}
        {children}
      </div>
      {action ? (
        <aside className="w-full min-[1000px]:w-[22rem] xl:w-[24rem] shrink-0">
          {action}
        </aside>
      ) : null}
    </div>
  );
}
