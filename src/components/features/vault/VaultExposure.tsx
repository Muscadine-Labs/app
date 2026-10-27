'use client';

import { formatPositionUsd } from '@/lib/formatter';
import { formatSharePercent, type ExposureSummary } from '@/lib/vault-details';

const CHIP_LIMIT = 3;

/** Bar and legend shades: the primary color stepped toward the surface. */
const SEGMENT_STRENGTHS = [100, 70, 48, 32, 22];

function segmentColor(index: number): string {
  const strength = SEGMENT_STRENGTHS[Math.min(index, SEGMENT_STRENGTHS.length - 1)];
  return `color-mix(in srgb, var(--primary) ${strength}%, var(--surface-active))`;
}

/** Top collateral tokens as compact chips, e.g. `cbXRP 68%`. */
export function ExposureChips({ exposure }: { exposure: ExposureSummary }) {
  if (exposure.items.length === 0) {
    return <span className="text-sm text-[var(--foreground-muted)]">—</span>;
  }
  const shown = exposure.items.slice(0, CHIP_LIMIT);
  const hidden = exposure.items.length - shown.length;
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((item) => (
        <span
          key={item.symbol}
          className="inline-flex items-center rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-1.5 py-0.5 text-xs font-medium text-[var(--foreground-secondary)] tabular-nums whitespace-nowrap"
        >
          {item.symbol} {formatSharePercent(item.share)}
        </span>
      ))}
      {hidden > 0 ? (
        <span className="inline-flex items-center px-1 py-0.5 text-xs text-[var(--foreground-muted)]">
          +{hidden}
        </span>
      ) : null}
    </div>
  );
}

/** Stacked share bar of collateral exposure (plus idle cash) with a legend. */
export function ExposureBar({ exposure }: { exposure: ExposureSummary }) {
  if (exposure.totalUsd <= 0) return null;
  const segments = [
    ...exposure.items.map((item, index) => ({
      key: item.symbol,
      label: item.symbol,
      usd: item.usd,
      share: item.share,
      color: segmentColor(index),
    })),
    ...(exposure.idleUsd > 0
      ? [
          {
            key: '__idle',
            label: 'Idle',
            usd: exposure.idleUsd,
            share: exposure.idleUsd / exposure.totalUsd,
            color: 'var(--border-strong)',
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-2">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--surface-active)]" aria-hidden>
        {segments.map((segment) => (
          <span
            key={segment.key}
            className="block h-full"
            style={{ width: `${segment.share * 100}%`, background: segment.color }}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--foreground-secondary)]">
        {segments.map((segment) => (
          <li key={segment.key} className="inline-flex items-center gap-1.5 tabular-nums" title={formatPositionUsd(segment.usd)}>
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: segment.color }} aria-hidden />
            {segment.label} {formatSharePercent(segment.share)}
          </li>
        ))}
      </ul>
    </div>
  );
}
