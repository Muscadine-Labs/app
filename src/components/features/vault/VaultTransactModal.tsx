'use client';

import { MorphoVaultData } from '@/types/vault';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui';
import { TransactionFlow, TransactionProgressBar } from '@/components/features/transactions';
import { useScopedVaultTransaction, type VaultTransactionTab } from '@/hooks/useScopedVaultTransaction';
import { ETH_GAS_RESERVE } from '@/lib/constants';
import { formatCurrency } from '@/lib/formatter';
import { usePrices } from '@/contexts/PriceContext';
import { ConnectButton } from '@/components/features/wallet';
import { isCbBtcVault, isWethVault } from '@/lib/transaction-form-utils';

interface VaultTransactModalProps {
  isOpen: boolean;
  onClose: () => void;
  vaultData: MorphoVaultData;
  initialTab: VaultTransactionTab;
}

const tabBaseClass =
  'flex-1 min-h-11 px-3 py-2.5 rounded-lg font-medium text-sm transition-colors cursor-pointer border touch-manipulation';
const tabActiveClass =
  'bg-[var(--primary)] text-white border-[var(--primary)]';
const tabInactiveClass =
  'bg-[var(--surface)]/70 text-[var(--foreground-secondary)] border-[var(--border-subtle)] hover:bg-[var(--surface)] active:bg-[var(--surface-hover)]';

const fieldClass =
  'w-full min-h-11 px-3 py-2.5 pr-16 bg-[var(--surface)]/80 border border-[var(--border-subtle)] rounded-lg text-base sm:text-sm text-[var(--foreground)] placeholder-[var(--foreground-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/40 focus:border-[var(--primary)]/30';

export function VaultTransactModal({
  isOpen,
  onClose,
  vaultData,
  initialTab,
}: VaultTransactModalProps) {
  const { btc: btcPrice, eth: ethPrice } = usePrices();
  const tx = useScopedVaultTransaction({
    vaultAddress: vaultData.address,
    vaultName: vaultData.name,
    vaultSymbol: vaultData.symbol,
    isOpen,
    initialTab,
  });

  const handleClose = () => {
    if (!tx.canClose) return;
    tx.handleResetToIdle();
    onClose();
  };

  const handleSuccessComplete = () => {
    tx.handleResetToIdle();
    onClose();
  };

  const modalTitle =
    tx.status === 'idle'
      ? tx.effectiveActiveTab === 'deposit'
        ? 'Deposit'
        : 'Withdraw'
      : tx.status === 'success'
        ? 'Transaction confirmed'
        : 'Review transaction';

  const showUsdHint = (() => {
    if (!tx.amount || !tx.derivedAsset) return null;
    const amountNum = parseFloat(tx.amount);
    if (isNaN(amountNum) || amountNum <= 0) return null;

    let price: number | null = null;
    if (isCbBtcVault(vaultData.address, vaultData.symbol) && btcPrice && btcPrice > 0) {
      price = btcPrice;
    } else if (isWethVault(vaultData.address, vaultData.symbol) && ethPrice && ethPrice > 0) {
      price = ethPrice;
    }
    if (!price) return null;

    const dollarAmount = amountNum * price;
    if (isNaN(dollarAmount) || dollarAmount <= 0) return null;
    return formatCurrency(dollarAmount);
  })();

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={modalTitle}
      closeOnOverlayClick={tx.canClose}
      layout="sheet"
      panelClassName="max-w-md max-h-[min(92dvh,720px)] w-full bg-[var(--background)] border-[var(--border-subtle)] shadow-lg rounded-t-2xl rounded-b-none sm:rounded-xl sm:max-h-[90vh]"
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

        {!tx.isConnected ? (
          <div className="py-5 text-center space-y-3">
            <p className="text-sm text-[var(--foreground-secondary)]">
              Connect your wallet to deposit or withdraw from this vault.
            </p>
            <div className="flex justify-center">
              <ConnectButton />
            </div>
          </div>
        ) : tx.status === 'idle' ? (
          <div className="space-y-3">
            <div className="flex gap-2 p-1 rounded-lg bg-[var(--surface)]/50 border border-[var(--border-subtle)]">
              <button
                type="button"
                onClick={() => tx.handleTabChange('deposit')}
                className={`${tabBaseClass} ${
                  tx.activeTab === 'deposit' ? tabActiveClass : tabInactiveClass
                }`}
              >
                Deposit
              </button>
              <button
                type="button"
                onClick={() => tx.handleTabChange('withdraw')}
                className={`${tabBaseClass} ${
                  tx.activeTab === 'withdraw' ? tabActiveClass : tabInactiveClass
                }`}
              >
                Withdraw
              </button>
            </div>

            <p className="text-xs text-[var(--foreground-muted)] leading-relaxed truncate" title={vaultData.name}>
              {tx.effectiveActiveTab === 'deposit'
                ? `Deposit ${vaultData.symbol} into ${vaultData.name}`
                : `Withdraw ${vaultData.symbol} from ${vaultData.name}`}
            </p>

            {tx.derivedAsset && (
              <div className="space-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)]/40 p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <label className="text-xs font-medium text-[var(--foreground-secondary)] shrink-0">
                    Amount ({tx.derivedAsset.symbol})
                  </label>
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    {isWethVault(vaultData.address, vaultData.symbol) &&
                      tx.effectiveActiveTab === 'deposit' && (
                        <select
                          value={tx.preferredAsset || 'ALL'}
                          onChange={(e) =>
                            tx.setPreferredAsset(e.target.value as 'ETH' | 'WETH' | 'ALL')
                          }
                          className="min-h-9 text-xs px-2 py-1.5 bg-[var(--surface)]/80 border border-[var(--border-subtle)] rounded text-[var(--foreground-muted)] hover:bg-[var(--surface)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/40 cursor-pointer touch-manipulation"
                        >
                          <option value="ALL">All (ETH + WETH)</option>
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
                          className="min-h-9 text-xs px-2 py-1.5 bg-[var(--surface)]/80 border border-[var(--border-subtle)] rounded text-[var(--foreground-muted)] hover:bg-[var(--surface)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/40 cursor-pointer touch-manipulation"
                        >
                          <option value="WETH">WETH</option>
                          <option value="ETH">ETH</option>
                        </select>
                      )}
                    <button
                      type="button"
                      onClick={tx.calculateMaxAmount}
                      disabled={tx.getMaxAmount === null || tx.isWithdrawMaxLoading}
                      className="min-h-9 min-w-11 px-2 text-xs text-[var(--primary)] hover:text-[var(--primary-hover)] disabled:text-[var(--foreground-muted)] disabled:cursor-not-allowed cursor-pointer touch-manipulation"
                    >
                      MAX
                    </button>
                  </div>
                </div>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={tx.amount}
                    onChange={(e) => tx.handleAmountChange(e.target.value)}
                    placeholder="0.00"
                    className={fieldClass}
                  />
                  {showUsdHint && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                      <span className="text-xs text-[var(--foreground-muted)]">
                        ≈ {showUsdHint}
                      </span>
                    </div>
                  )}
                </div>
                <p className="text-xs text-[var(--foreground-muted)]">
                  {tx.effectiveActiveTab === 'deposit'
                    ? tx.getWalletBalanceText
                    : tx.getVaultBalanceText}
                </p>
                {tx.isWethVaultEthDeposit && !tx.isDevMode && (
                  <p className="text-xs text-[var(--foreground-muted)]">
                    {ETH_GAS_RESERVE} ETH is intentionally left in your wallet for network gas fees.
                  </p>
                )}
                {tx.exceedsBalance && (
                  <div className="p-2.5 bg-[var(--warning-subtle)] rounded-lg border border-[var(--warning)]/60 space-y-2">
                    <p className="text-xs text-[var(--foreground)]">
                      <span className="font-medium">Warning:</span> Amount exceeds available balance.
                      This transaction will fail if you proceed.
                    </p>
                    {tx.isDevMode && (
                      <label className="flex items-start gap-2 cursor-pointer text-xs text-[var(--foreground)]">
                        <input
                          type="checkbox"
                          checked={tx.balanceBypassAcknowledged}
                          onChange={(e) => tx.setBalanceBypassAcknowledged(e.target.checked)}
                          className="mt-0.5 rounded border-[var(--border-subtle)]"
                        />
                        <span>Proceed anyway (Dev mode — for testing)</span>
                      </label>
                    )}
                  </div>
                )}
              </div>
            )}

            <Button
              onClick={tx.handleStartTransaction}
              disabled={
                !tx.fromAccount ||
                !tx.toAccount ||
                !tx.derivedAsset ||
                !tx.amount ||
                parseFloat(tx.amount) <= 0 ||
                tx.blockContinueForBalance
              }
              variant="primary"
              size="lg"
              fullWidth
              className="min-h-11 touch-manipulation"
            >
              Continue
            </Button>
          </div>
        ) : (
          <TransactionFlow
            embedded
            onSuccessComplete={handleSuccessComplete}
            onReturnToIdle={tx.handleResetToIdle}
          />
        )}
      </div>
    </Modal>
  );
}
