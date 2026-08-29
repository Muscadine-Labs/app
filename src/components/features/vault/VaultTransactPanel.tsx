'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Image from 'next/image';
import { MorphoVaultData, getVaultLogo } from '@/types/vault';
import { Button, Modal } from '@/components/ui';
import { TransactionFlow, TransactionProgressBar } from '@/components/features/transactions';
import {
  useScopedVaultTransaction,
  type VaultTransactionTab,
} from '@/hooks/useScopedVaultTransaction';
import { ETH_GAS_RESERVE } from '@/lib/constants';
import {
  formatAssetBalance,
  formatCurrency,
  formatPercentage,
  formatVaultDetailTokenAmount,
} from '@/lib/formatter';
import { usePrices } from '@/contexts/PriceContext';
import { ConnectButton } from '@/components/features/wallet';
import { isWethVault } from '@/lib/transaction-form-utils';
import { parseTransactionAmount } from '@/lib/liquidity-utils';
import {
  buildPastEarningsRows,
  buildProjectedEarningsRows,
  type ActivityFlowEvent,
} from '@/lib/interest-utils';

type RewardsMode = 'past' | 'future';

interface VaultTransactPanelProps {
  vaultData: MorphoVaultData;
  initialTab: VaultTransactionTab;
  onTabChange: (tab: VaultTransactionTab) => void;
  positionDecimals: number;
  currentAssetsRaw: bigint;
  history: Array<{ timestamp: number; assets: number }>;
  events: ActivityFlowEvent[] | null;
  nowTs: number;
  assetPriceUsd: number;
  isConnected: boolean;
  earningsLoading: boolean;
}

function amountUsdValue(
  amount: string,
  symbol: string,
  btcPrice: number | null,
  ethPrice: number | null
): number {
  const parsed = parseFloat(amount);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  const upper = symbol.toUpperCase();
  if (upper === 'USDC') return parsed;
  if (upper === 'WETH' || upper === 'ETH') return ethPrice && ethPrice > 0 ? parsed * ethPrice : 0;
  if (upper === 'CBBTC' || upper === 'CBTC' || upper === 'BTC') {
    return btcPrice && btcPrice > 0 ? parsed * btcPrice : 0;
  }
  return 0;
}

function StatsRow({
  label,
  value,
  icon,
}: {
  label: ReactNode;
  value: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="flex items-center gap-2 min-w-0 text-sm text-[var(--foreground-secondary)]">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="text-sm font-medium text-[var(--foreground)] tabular-nums shrink-0 text-right">
        {value}
      </div>
    </div>
  );
}

export function VaultTransactPanel({
  vaultData,
  initialTab,
  onTabChange,
  positionDecimals,
  currentAssetsRaw,
  history,
  events,
  nowTs,
  assetPriceUsd,
  isConnected,
  earningsLoading,
}: VaultTransactPanelProps) {
  const { btc: btcPrice, eth: ethPrice } = usePrices();
  const [rewardsMode, setRewardsMode] = useState<RewardsMode>('future');
  const tx = useScopedVaultTransaction({
    vaultAddress: vaultData.address,
    vaultName: vaultData.name,
    vaultSymbol: vaultData.symbol,
    isOpen: true,
    initialTab,
  });

  const { status, effectiveActiveTab, handleTabChange } = tx;
  const reviewOpen = status !== 'idle';
  const reviewTitle =
    status === 'success' ? 'Transaction confirmed' : 'Review transaction';

  useEffect(() => {
    if (status !== 'idle') return;
    if (effectiveActiveTab === initialTab) return;
    handleTabChange(initialTab);
  }, [initialTab, status, effectiveActiveTab, handleTabChange]);

  const handleTabClick = (tab: VaultTransactionTab) => {
    if (reviewOpen) return;
    handleTabChange(tab);
    onTabChange(tab);
  };

  const handleSuccessComplete = () => {
    tx.handleResetToIdle();
  };

  const handleReviewClose = () => {
    if (!tx.canClose) return;
    tx.handleResetToIdle();
  };

  const depositsDisabled =
    vaultData.status === 'paused' || vaultData.status === 'deprecated';

  const inputUsd = amountUsdValue(
    tx.amount,
    tx.derivedAsset?.symbol || vaultData.symbol,
    btcPrice,
    ethPrice
  );

  const availableLabel = useMemo(() => {
    const symbol = tx.derivedAsset?.symbol || vaultData.symbol;
    if (tx.maxAmount === null || tx.isWithdrawMaxLoading) return `0.00 ${symbol}`;
    return formatAssetBalance(tx.maxAmount, symbol, undefined, true);
  }, [tx.derivedAsset?.symbol, tx.maxAmount, tx.isWithdrawMaxLoading, vaultData.symbol]);

  const pastRows = useMemo(
    () =>
      buildPastEarningsRows({
        nowTs,
        decimals: positionDecimals,
        assetPriceUsd,
        currentAssetsRaw,
        history,
        events,
      }),
    [assetPriceUsd, currentAssetsRaw, events, history, nowTs, positionDecimals]
  );

  const futureRows = useMemo(() => {
    const decimals = tx.derivedAsset?.decimals ?? positionDecimals;
    const typedRaw = parseTransactionAmount(
      tx.amount.trim().replace(/\.$/, ''),
      decimals
    );
    let projectedAssets = currentAssetsRaw;
    if (typedRaw > BigInt(0)) {
      if (tx.effectiveActiveTab === 'deposit') {
        projectedAssets = currentAssetsRaw + typedRaw;
      } else if (currentAssetsRaw > typedRaw) {
        projectedAssets = currentAssetsRaw - typedRaw;
      } else {
        projectedAssets = BigInt(0);
      }
    }
    return buildProjectedEarningsRows({
      currentAssetsRaw: projectedAssets,
      netApy: vaultData.apy,
      decimals: positionDecimals,
      assetPriceUsd,
    });
  }, [
    assetPriceUsd,
    currentAssetsRaw,
    positionDecimals,
    tx.amount,
    tx.derivedAsset?.decimals,
    tx.effectiveActiveTab,
    vaultData.apy,
  ]);

  const logo = getVaultLogo(vaultData.symbol);
  const actionLabel = tx.effectiveActiveTab === 'deposit' ? 'Deposit' : 'Withdraw';
  const actionDisabled =
    reviewOpen ||
    (depositsDisabled && tx.effectiveActiveTab === 'deposit') ||
    !tx.fromAccount ||
    !tx.toAccount ||
    !tx.derivedAsset ||
    !tx.hasValidAmount ||
    tx.blockContinueForBalance;

  const ctaLabel =
    depositsDisabled && tx.effectiveActiveTab === 'deposit'
      ? 'Deposits are disabled'
      : actionLabel;

  const tabClass = (active: boolean) =>
    `px-3 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer ${
      active
        ? 'bg-[var(--surface-elevated)] text-[var(--foreground)] border border-[var(--border)] shadow-sm'
        : 'text-[var(--foreground-secondary)] hover:text-[var(--foreground)]'
    }`;

  return (
    <div className="w-full flex flex-col gap-3">
      <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => handleTabClick('deposit')}
              className={tabClass(tx.effectiveActiveTab === 'deposit')}
            >
              Deposit
            </button>
            <button
              type="button"
              onClick={() => handleTabClick('withdraw')}
              className={tabClass(tx.effectiveActiveTab === 'withdraw')}
            >
              Withdraw
            </button>
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="flex items-center justify-between gap-2 mb-3">
              <p className="text-sm text-[var(--foreground-secondary)]">
                {tx.effectiveActiveTab === 'deposit' ? 'Deposit' : 'Withdraw'} {vaultData.symbol}
              </p>
              <div className="flex items-center gap-2">
                {isWethVault(vaultData.address, vaultData.symbol) &&
                  tx.effectiveActiveTab === 'deposit' && (
                    <select
                      value={tx.preferredAsset || 'ALL'}
                      onChange={(e) =>
                        tx.setPreferredAsset(e.target.value as 'ETH' | 'WETH' | 'ALL')
                      }
                      className="text-xs px-2 py-1 bg-[var(--surface-elevated)] border border-[var(--border-subtle)] rounded text-[var(--foreground-muted)] focus:outline-none cursor-pointer"
                    >
                      <option value="ALL">ETH + WETH</option>
                      <option value="ETH">ETH</option>
                      <option value="WETH">WETH</option>
                    </select>
                  )}
                {isWethVault(vaultData.address, vaultData.symbol) &&
                  tx.effectiveActiveTab === 'withdraw' && (
                    <select
                      value={tx.preferredAsset || 'WETH'}
                      onChange={(e) =>
                        tx.setPreferredAsset(e.target.value as 'ETH' | 'WETH')
                      }
                      className="text-xs px-2 py-1 bg-[var(--surface-elevated)] border border-[var(--border-subtle)] rounded text-[var(--foreground-muted)] focus:outline-none cursor-pointer"
                    >
                      <option value="WETH">WETH</option>
                      <option value="ETH">ETH</option>
                    </select>
                  )}
                <Image
                  src={logo}
                  alt={vaultData.symbol}
                  width={22}
                  height={22}
                  className="rounded-full shrink-0"
                />
              </div>
            </div>

            <input
              type="text"
              inputMode="decimal"
              value={tx.amount}
              onChange={(e) => tx.handleAmountChange(e.target.value)}
              placeholder="0.00"
              disabled={reviewOpen}
              className="w-full bg-transparent text-3xl font-semibold text-[var(--foreground)] placeholder-[var(--foreground-muted)] outline-none tabular-nums disabled:opacity-60"
            />

            <div className="flex items-center justify-between gap-2 mt-3">
              <p className="text-sm text-[var(--foreground-muted)] tabular-nums">
                {formatCurrency(inputUsd)}
              </p>
              <div className="flex items-center gap-2 min-w-0">
                <p className="text-sm text-[var(--foreground-muted)] truncate tabular-nums">
                  {availableLabel}
                </p>
                <button
                  type="button"
                  onClick={tx.calculateMaxAmount}
                  disabled={tx.maxAmount === null || tx.isWithdrawMaxLoading}
                  className="text-sm font-medium text-[var(--foreground-secondary)] hover:text-[var(--foreground)] disabled:text-[var(--foreground-muted)] disabled:cursor-not-allowed cursor-pointer"
                >
                  MAX
                </button>
              </div>
            </div>

            {tx.isWethVaultEthDeposit && (
              <p className="mt-2 text-xs text-[var(--foreground-muted)]">
                {ETH_GAS_RESERVE} ETH is left in your wallet for gas.
              </p>
            )}
            {tx.exceedsBalance && (
              <p className="mt-2 text-xs text-[var(--warning)]">
                Amount exceeds available balance.
              </p>
            )}
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2">
            <StatsRow
              label="Network"
              icon={
                <span
                  className="w-3.5 h-3.5 rounded-sm shrink-0 bg-[var(--primary)]"
                  aria-hidden
                />
              }
              value="Base"
            />
            <StatsRow label="APY" value={formatPercentage(vaultData.apy) || '—'} />

            <div className="flex items-center gap-1 pt-2 mt-1 border-t border-[var(--border-subtle)]">
              <button
                type="button"
                onClick={() => setRewardsMode('past')}
                className={tabClass(rewardsMode === 'past')}
              >
                Past rewards
              </button>
              <button
                type="button"
                onClick={() => setRewardsMode('future')}
                className={tabClass(rewardsMode === 'future')}
              >
                Future rewards
              </button>
            </div>

            {earningsLoading ? (
              <p className="py-2 text-xs text-[var(--foreground-muted)]">Loading rewards…</p>
            ) : rewardsMode === 'past' ? (
              <>
                {pastRows.map((row) => (
                  <StatsRow
                    key={row.label}
                    label={row.label}
                    value={
                      <span className="flex flex-col items-end">
                        <span>
                          {formatVaultDetailTokenAmount(
                            row.raw.toString(),
                            positionDecimals,
                            vaultData.symbol
                          )}
                        </span>
                        <span className="text-xs font-normal text-[var(--foreground-muted)]">
                          {formatCurrency(Math.max(0, row.usd))}
                        </span>
                      </span>
                    }
                  />
                ))}
                {pastRows.length === 0 ? (
                  <p className="pb-2 text-[10px] text-[var(--foreground-muted)] leading-relaxed">
                    Past week, month, and year hide until you had a position at the start of that
                    window.
                  </p>
                ) : null}
              </>
            ) : (
              <>
                {futureRows.map((row) => (
                  <StatsRow
                    key={row.label}
                    label={row.label}
                    value={formatCurrency(Math.max(0, row.usd))}
                  />
                ))}
                <p className="pb-2 text-[10px] text-[var(--foreground-muted)] leading-relaxed">
                  {tx.amount && parseFloat(tx.amount) > 0
                    ? tx.effectiveActiveTab === 'deposit'
                      ? 'Includes this deposit, if current net APY holds. Not a guarantee.'
                      : 'After this withdrawal, if current net APY holds. Not a guarantee.'
                    : 'If current net APY holds. Estimates are not a guarantee.'}
                </p>
              </>
            )}
          </div>

          {!isConnected ? (
            <div className="flex justify-center">
              <ConnectButton />
            </div>
          ) : (
            <Button
              onClick={tx.handleStartTransaction}
              disabled={actionDisabled}
              variant="primary"
              size="lg"
              fullWidth
              className="min-h-11 rounded-xl"
            >
              {ctaLabel}
            </Button>
          )}

      <Modal
        isOpen={reviewOpen}
        onClose={handleReviewClose}
        title={reviewTitle}
        showCloseButton={tx.canClose}
        closeOnOverlayClick={tx.canClose}
        closeOnEscape={tx.canClose}
        layout="sheet"
        panelClassName="max-w-md max-h-[min(92dvh,720px)] bg-[var(--background)] border-[var(--border-subtle)] sm:max-w-md sm:max-h-[90vh]"
        headerClassName="px-4 py-3 sm:px-4 sm:py-3 border-[var(--border-subtle)]/80 bg-[var(--background)] shrink-0"
        titleClassName="text-base font-semibold truncate pr-2"
        contentClassName="px-4 py-4 sm:px-4 sm:py-4 bg-[var(--background)] pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-4"
      >
        <div className="space-y-3">
          <TransactionProgressBar
            steps={tx.getProgressSteps()}
            isSuccess={tx.status === 'success'}
            compact
          />
          <TransactionFlow
            embedded
            onSuccessComplete={handleSuccessComplete}
            onReturnToIdle={tx.handleResetToIdle}
          />
        </div>
      </Modal>
    </div>
  );
}
