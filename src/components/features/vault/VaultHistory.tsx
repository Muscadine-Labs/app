'use client';

import { useState, useEffect } from 'react';
import { MorphoVaultData } from '@/types/vault';
import { formatVaultDetailTokenAmount, formatDate, formatCurrency } from '@/lib/formatter';
import { useConnection } from 'wagmi';
import { Skeleton } from '@/components/ui/Skeleton';
import type { Transaction } from '@/types/api';
import {
  formatTransactionTypeLabel,
  transactionTypeDotClass,
} from '@/lib/transaction-labels';

function transactionKey(tx: Transaction): string {
  return `${tx.id ?? ''}-${tx.transactionHash ?? ''}-${tx.type}-${tx.timestamp}`;
}

/** Morpho can return the same event twice in one feed; keep one. */
function dedupeTransactions<T extends Transaction>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((tx) => {
    const key = transactionKey(tx);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

interface VaultHistoryProps {
  vaultData: MorphoVaultData;
}

/**
 * The connected wallet's own deposits, withdrawals and transfers in this vault. Morpho REST has
 * no vault-wide activity route, so there is no "all activity" view (see
 * docs/morpho-rest-migration.md, "Dropped until Morpho adds them").
 */
export default function VaultHistory({ vaultData }: VaultHistoryProps) {
  const { address } = useConnection();
  // Keyed by wallet + vault, so a switch never shows another wallet's rows while it loads.
  const requestKey = address ? `${vaultData.address}:${address}` : null;
  const [result, setResult] = useState<{ key: string; rows: Transaction[]; failed: boolean } | null>(null);
  const current = result && result.key === requestKey ? result : null;
  const loading = requestKey !== null && current === null;
  const failed = current?.failed ?? false;
  const userTransactions = current?.rows ?? [];

  useEffect(() => {
    if (!address || !requestKey) return;
    const abortController = new AbortController();

    const fetchActivity = async () => {
      try {
        const response = await fetch(
          `/api/vault/v2/${vaultData.address}/activity?chainId=${vaultData.chainId}&userAddress=${address}`,
          { signal: abortController.signal }
        );
        if (!response.ok) throw new Error('Failed to fetch vault activity');
        const payload = await response.json();
        if (payload?.error) throw new Error('Failed to fetch vault activity');
        if (abortController.signal.aborted) return;
        const rows = Array.isArray(payload.transactions) ? (payload.transactions as Transaction[]) : [];
        setResult({
          key: requestKey,
          rows: dedupeTransactions([...rows].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))),
          failed: false,
        });
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
        if (abortController.signal.aborted) return;
        // A failed read is not "no transactions".
        setResult({ key: requestKey, rows: [], failed: true });
      }
    };

    void fetchActivity();

    return () => abortController.abort();
  }, [vaultData.address, vaultData.chainId, address, requestKey]);

  const getExplorerUrl = (txHash: string) => {
    return `https://basescan.org/tx/${txHash}`;
  };

  const recentTransactions = userTransactions.slice(0, 50);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0 mb-6">
        <div className="flex items-center gap-4">
          <div>
            <h2 className="text-lg font-semibold text-[var(--foreground)] mb-1">Transaction History</h2>
            <p className="text-sm text-[var(--foreground-secondary)]">
              Your deposits, withdrawals, and transfers in this vault
            </p>
          </div>
          {address && userTransactions.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const csv = [
                    ['Date', 'Type', 'Amount (USD)', 'Transaction Hash'].join(','),
                    ...userTransactions.map(tx => [
                      formatDate(tx.timestamp),
                      formatTransactionTypeLabel(tx.type),
                      tx.assetsUsd ? formatCurrency(tx.assetsUsd).replace('$', '') : '0',
                      tx.transactionHash || '',
                    ].join(',')),
                  ].join('\n');

                  const blob = new Blob([csv], { type: 'text/csv' });
                  const url = window.URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `vault-activity-${vaultData.symbol}-${Date.now()}.csv`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  window.URL.revokeObjectURL(url);
                }}
                className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors bg-[var(--surface-elevated)] text-[var(--foreground-secondary)] hover:text-[var(--foreground)] border border-[var(--border-subtle)] cursor-pointer"
              >
                Download CSV
              </button>
              <a
                href={`https://debank.com/profile/${address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors bg-[var(--surface-elevated)] text-[var(--foreground-secondary)] hover:text-[var(--foreground)] border border-[var(--border-subtle)] cursor-pointer"
              >
                View your Wallet portfolio
              </a>
            </div>
          )}
        </div>
      </div>

      {/* Transaction List - Scrollable */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-4 bg-[var(--surface-elevated)] rounded-lg border border-[var(--border-subtle)]"
              >
                <div className="flex items-center gap-4 flex-1">
                  <Skeleton variant="circular" width="8px" height="8px" />
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <Skeleton width="4rem" height="1rem" />
                      <Skeleton width="5rem" height="1rem" />
                    </div>
                    <div className="flex items-center gap-2">
                      <Skeleton width="6rem" height="0.75rem" />
                      <Skeleton width="6rem" height="0.75rem" />
                    </div>
                  </div>
                </div>
                <Skeleton width="3rem" height="0.75rem" />
              </div>
            ))}
          </div>
        ) : recentTransactions.length > 0 ? (
          <div className="space-y-2">
            {recentTransactions.map((tx) => (
              <div
                key={transactionKey(tx)}
                className="flex items-center justify-between p-4 bg-[var(--surface-elevated)] rounded-lg border border-[var(--border-subtle)] hover:border-[var(--border)] transition-colors"
              >
                <div className="flex items-center gap-4 flex-1">
                  <div className={`w-2 h-2 rounded-full ${transactionTypeDotClass(tx.type)}`} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-[var(--foreground)]">
                        {formatTransactionTypeLabel(tx.type)}
                      </span>
                      {tx.assets && (
                        <span className="text-sm text-[var(--foreground)] font-medium">
                          {formatVaultDetailTokenAmount(
                            tx.assets,
                            vaultData.assetDecimals || 18,
                            vaultData.symbol
                          )}
                        </span>
                      )}
                      {tx.assetsUsd !== undefined && tx.assetsUsd > 0 && (
                        <span className="text-sm text-[var(--foreground-secondary)]">
                          ({formatCurrency(tx.assetsUsd)})
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-[var(--foreground-secondary)]">
                        {formatDate(tx.timestamp)}
                      </span>
                    </div>
                  </div>
                </div>
                {tx.transactionHash && (
                  <a
                    href={getExplorerUrl(tx.transactionHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[var(--primary)] hover:text-[var(--primary-hover)] ml-4"
                  >
                    View →
                  </a>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <p className="text-sm text-[var(--foreground-muted)]">
              {!address
                ? 'Connect a wallet to see your transactions in this vault'
                : failed
                  ? 'Your transactions could not be loaded right now. Try again in a moment.'
                  : "You haven't made any transactions yet"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
