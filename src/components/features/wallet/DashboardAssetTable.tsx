'use client';

import { type KeyboardEvent, type ReactNode } from 'react';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  formatPositionTokenAmount,
  formatPositionUsd,
} from '@/lib/formatter';
import { useIsClient } from '@/hooks/useClientOnly';

export type DashboardAssetRow = {
  key: string;
  name: string;
  symbol: string;
  icon: ReactNode;
  positionRaw: string;
  positionDecimals: number;
  positionSymbol: string;
  positionUsd: number;
  earnedRaw: string;
  earnedDecimals: number;
  earnedSymbol: string;
  earnedUsd: number;
  onActivate?: () => void;
};

function handleRowKeyDown(event: KeyboardEvent, onActivate: () => void) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    onActivate();
  }
}

function AmountPair({
  raw,
  decimals,
  symbol,
  usd,
  align = 'end',
}: {
  raw: string;
  decimals: number;
  symbol: string;
  usd: number;
  align?: 'start' | 'end';
}) {
  const alignClass = align === 'start' ? 'items-start' : 'items-end';
  return (
    <div className={`flex flex-col ${alignClass} gap-0.5`}>
      <span className="text-sm font-medium text-[var(--foreground)] tabular-nums">
        {formatPositionTokenAmount(raw, decimals, symbol)}
      </span>
      <span className="text-xs text-[var(--foreground-secondary)] tabular-nums">
        {formatPositionUsd(usd)}
      </span>
    </div>
  );
}

function MobileStatBlock({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--foreground-muted)]">
        {label}
      </span>
      {children}
    </div>
  );
}

export default function DashboardAssetTable({
  nameHeader,
  rows,
  emptyMessage,
}: {
  nameHeader: string;
  rows: DashboardAssetRow[];
  emptyMessage: string;
}) {
  const isMounted = useIsClient();

  if (!isMounted) {
    return (
      <div className="px-4 py-8">
        <Skeleton width="100%" height="8rem" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="px-4 py-12 text-center">
        <p className="text-sm text-[var(--foreground-muted)]">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="@container min-w-0">
      <div className="@min-[640px]:hidden">
        {rows.map((row) => {
          const clickable = Boolean(row.onActivate);
          const wrapperProps = clickable
            ? {
                role: 'button' as const,
                tabIndex: 0,
                onClick: row.onActivate,
                onKeyDown: (event: KeyboardEvent) =>
                  handleRowKeyDown(event, row.onActivate!),
                className:
                  'w-full text-left px-4 py-4 border-b border-[var(--border)] hover:bg-[var(--surface-hover)] active:bg-[var(--surface-hover)] transition-colors touch-manipulation cursor-pointer',
              }
            : {
                className: 'w-full text-left px-4 py-4 border-b border-[var(--border)]',
              };

          return (
            <div key={row.key} {...wrapperProps}>
              <div className="flex items-center gap-3 mb-3">
                {row.icon}
                <div className="min-w-0">
                  <span className="text-sm font-medium text-[var(--foreground)] block truncate">
                    {row.name}
                  </span>
                  <span className="text-[10px] text-[var(--foreground-muted)]">
                    {row.symbol}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <MobileStatBlock label="Your Position">
                  <AmountPair
                    raw={row.positionRaw}
                    decimals={row.positionDecimals}
                    symbol={row.positionSymbol}
                    usd={row.positionUsd}
                    align="start"
                  />
                </MobileStatBlock>
                <MobileStatBlock label="Earned Interest">
                  <AmountPair
                    raw={row.earnedRaw}
                    decimals={row.earnedDecimals}
                    symbol={row.earnedSymbol}
                    usd={row.earnedUsd}
                    align="start"
                  />
                </MobileStatBlock>
              </div>
            </div>
          );
        })}
      </div>

      <div className="hidden @min-[640px]:block min-w-0">
        <table className="w-full table-fixed">
          <colgroup>
            <col className="w-[40%]" />
            <col className="w-[30%]" />
            <col className="w-[30%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-[var(--border)] text-left">
              <th className="px-2 py-2.5 text-xs font-medium text-[var(--foreground-secondary)]">
                {nameHeader}
              </th>
              <th className="px-2 py-2.5 text-xs font-medium text-[var(--foreground-secondary)] text-right">
                Your Position
              </th>
              <th className="px-2 py-2.5 text-xs font-medium text-[var(--foreground-secondary)] text-right">
                Earned Interest
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const clickable = Boolean(row.onActivate);
              return (
                <tr
                  key={row.key}
                  role={clickable ? 'button' : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  aria-label={clickable ? `Open ${row.name}` : undefined}
                  onClick={clickable ? row.onActivate : undefined}
                  onKeyDown={
                    clickable
                      ? (event) => handleRowKeyDown(event, row.onActivate!)
                      : undefined
                  }
                  className={`border-b border-[var(--border)] transition-colors ${
                    clickable
                      ? 'hover:bg-[var(--surface-hover)] cursor-pointer'
                      : 'cursor-default'
                  }`}
                >
                  <td className="px-2 py-3 align-middle">
                    <div className="flex items-center gap-2 min-w-0">
                      {row.icon}
                      <div className="min-w-0">
                        <span className="text-sm font-medium text-[var(--foreground)] truncate block">
                          {row.name}
                        </span>
                        <span className="text-[10px] text-[var(--foreground-muted)]">
                          {row.symbol}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-3 align-middle text-right">
                    <AmountPair
                      raw={row.positionRaw}
                      decimals={row.positionDecimals}
                      symbol={row.positionSymbol}
                      usd={row.positionUsd}
                    />
                  </td>
                  <td className="px-2 py-3 align-middle text-right">
                    <AmountPair
                      raw={row.earnedRaw}
                      decimals={row.earnedDecimals}
                      symbol={row.earnedSymbol}
                      usd={row.earnedUsd}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
