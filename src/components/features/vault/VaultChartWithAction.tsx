import type { ReactNode } from 'react';

/**
 * Desktop (≥1000px): left column is status (header + chart), right column is
 * the transact panel, top-aligned. Below 1000px: header → panel → chart so
 * the form is above the fold.
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
  if (!action) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        {children}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 min-[1000px]:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_24rem] min-[1000px]:grid-rows-[auto_minmax(20rem,1fr)] min-[1000px]:items-stretch">
      {header ? <div className="min-w-0">{header}</div> : null}
      <aside className="min-w-0 w-full min-[1000px]:col-start-2 min-[1000px]:row-start-1 min-[1000px]:row-span-2">
        {action}
      </aside>
      <div className="min-w-0 min-[1000px]:col-start-1 min-[1000px]:min-h-0 min-[1000px]:h-full flex flex-col">
        {children}
      </div>
    </div>
  );
}
