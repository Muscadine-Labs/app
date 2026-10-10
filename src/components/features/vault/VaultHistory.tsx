'use client';

import { useState, useEffect } from 'react';
import { MorphoVaultData } from '@/types/vault';
import { formatVaultDetailTokenAmount, formatDate, formatCurrency } from '@/lib/formatter';
import { useAccount } from 'wagmi';
import CopiableAddress from '@/components/common/CopiableAddress';
import { Skeleton } from '@/components/ui/Skeleton';
import type { Transaction } from '@/types/api';
import {
  formatTransactionTypeLabel,
  transactionTypeDotClass,
} from '@/lib/transaction-labels';

interface VaultHistoryProps {
  vaultData: MorphoVaultData;
}

export default function VaultHistory({ vaultData }: VaultHistoryProps) {
  const { address } = useAccount();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [userTransactions, setUserTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUserOnly, setShowUserOnly] = useState(true);
  const [allActivityLoaded, setAllActivityLoaded] = useState(false);

  useEffect(() => {
    const abortController = new AbortController();

    const fetchActivity = async () => {
      setLoading(true);
      try {
        if (address && showUserOnly) {
          const userResponse = await fetch(
            `/api/vault/${vaultData.version}/${vaultData.address}/activity?chainId=${vaultData.chainId}&userAddress=${address}`,
            { signal: abortController.signal }
          );
          const userResponseData = await userResponse.json();
          setUserTransactions(userResponseData.transactions || []);
          return;
        }

        const requests = [
          fetch(
            `/api/vault/${vaultData.version}/${vaultData.address}/activity?chainId=${vaultData.chainId}`,
            { signal: abortController.signal }
          ),
        ];

        if (address) {
          requests.push(
            fetch(
              `/api/vault/${vaultData.version}/${vaultData.address}/activity?chainId=${vaultData.chainId}&userAddress=${address}`,
              { signal: abortController.signal }
            )
          );
        }

        const responses = await Promise.all(requests);
        const allData = await responses[0].json();
        setTransactions(allData.transactions || []);
        setAllActivityLoaded(true);

        if (responses[1]) {
          const userResponseData = await responses[1].json();
          setUserTransactions(userResponseData.transactions || []);
        } else {
          setUserTransactions([]);
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
        setTransactions([]);
        setUserTransactions([]);
      } finally {
        if (!abortController.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void fetchActivity();

    return () => abortController.abort();
  }, [vaultData.address, vaultData.chainId, vaultData.version, address, showUserOnly]);

  const getExplorerUrl = (txHash: string) => {
    return `https://basescan.org/tx/${txHash}`;
  };

  const displayTransactions = showUserOnly && address ? userTransactions : transactions;
  const recentTransactions = displayTransactions.slice(0, 50);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0 mb-6">
        <div className="flex items-center gap-4">
          <div>
            <h2 className="text-lg font-semibold text-[var(--foreground)] mb-1">Transaction History</h2>
            <p className="text-sm text-[var(--foreground-secondary)]">
              View all deposits, withdrawals, and transfers for this vault
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
        {address && (
          <button
            onClick={() => setShowUserOnly(!showUserOnly)}
            className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors bg-[var(--surface-elevated)] text-[var(--foreground-secondary)] hover:text-[var(--foreground)] border border-[var(--border-subtle)] cursor-pointer"
          >
            {showUserOnly ? 'Show All' : 'Show Mine'}
          </button>
        )}
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
                key={tx.id || tx.transactionHash}
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
                      {tx.user && !showUserOnly && (
                        <>
                          <span className="text-xs text-[var(--foreground-muted)]">•</span>
                          <CopiableAddress address={tx.user} truncateLength={4} />
                        </>
                      )}
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
              {showUserOnly && address 
                ? "You haven't made any transactions yet"
                : allActivityLoaded
                  ? 'No recent activity'
                  : 'No recent activity'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
