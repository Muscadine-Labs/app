'use client';

import { MorphoVaultData } from '@/types/vault';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui';
import { TransactionFlow, TransactionProgressBar } from '@/components/features/transactions';
import { useScopedVaultTransaction, type VaultTransactionTab } from '@/hooks/useScopedVaultTransaction';
import { ETH_GAS_RESERVE } from '@/lib/constants';
import { formatCurrency } from '@/lib/formatter';
import { usePrices } from '@/contexts/PriceContext';
import { isCbBtcVault, isWethVault } from '@/lib/transaction-form-utils';

interface VaultTransactModalProps {
  isOpen: boolean;
  onClose: () => void;
  vaultData: MorphoVaultData;
  initialTab: VaultTransactionTab;
}

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
    >
      <div className="space-y-4">
        <TransactionProgressBar
          steps={tx.getProgressSteps()}
          isSuccess={tx.status === 'success'}
        />

        {!tx.isConnected ? (
          <div className="py-6 text-center space-y-2">
            <p className="text-sm text-[var(--foreground-secondary)]">
              Connect your wallet to deposit or withdraw from this vault.
            </p>
          </div>
        ) : tx.status === 'idle' ? (
          <div className="space-y-4">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => tx.handleTabChange('deposit')}
                className={`flex-1 px-4 py-2.5 rounded-lg font-medium text-sm transition-colors cursor-pointer ${
                  tx.activeTab === 'deposit'
                    ? 'bg-[var(--primary)] text-white'
                    : 'bg-[var(--background)] text-[var(--foreground-secondary)] hover:bg-[var(--surface-elevated)]'
                }`}
              >
                Deposit
              </button>
              <button
                type="button"
                onClick={() => tx.handleTabChange('withdraw')}
                className={`flex-1 px-4 py-2.5 rounded-lg font-medium text-sm transition-colors cursor-pointer ${
                  tx.activeTab === 'withdraw'
                    ? 'bg-[var(--primary)] text-white'
                    : 'bg-[var(--background)] text-[var(--foreground-secondary)] hover:bg-[var(--surface-elevated)]'
                }`}
              >
                Withdraw
              </button>
            </div>

            <p className="text-sm text-[var(--foreground-secondary)]">
              {tx.effectiveActiveTab === 'deposit'
                ? `Deposit ${vaultData.symbol} into ${vaultData.name}`
                : `Withdraw ${vaultData.symbol} from ${vaultData.name}`}
            </p>

            {tx.derivedAsset && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-sm font-medium text-[var(--foreground-secondary)]">
                    Amount ({tx.derivedAsset.symbol})
                  </label>
                  <div className="flex items-center gap-2">
                    {isWethVault(vaultData.address, vaultData.symbol) &&
                      tx.effectiveActiveTab === 'deposit' && (
                        <select
                          value={tx.preferredAsset || 'ALL'}
                          onChange={(e) =>
                            tx.setPreferredAsset(e.target.value as 'ETH' | 'WETH' | 'ALL')
                          }
                          className="text-xs px-1.5 py-0.5 bg-[var(--background)] border border-[var(--border-subtle)] rounded text-[var(--foreground-muted)] hover:bg-[var(--surface-elevated)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)] cursor-pointer"
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
                          className="text-xs px-1.5 py-0.5 bg-[var(--background)] border border-[var(--border-subtle)] rounded text-[var(--foreground-muted)] hover:bg-[var(--surface-elevated)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)] cursor-pointer"
                        >
                          <option value="WETH">WETH</option>
                          <option value="ETH">ETH</option>
                        </select>
                      )}
                    <button
                      type="button"
                      onClick={tx.calculateMaxAmount}
                      disabled={tx.getMaxAmount === null}
                      className="text-xs text-[var(--primary)] hover:text-[var(--primary-hover)] disabled:text-[var(--foreground-muted)] disabled:cursor-not-allowed cursor-pointer"
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
                    className="w-full px-4 py-3 pr-20 bg-[var(--background)] border border-[var(--border-subtle)] rounded-lg text-[var(--foreground)] placeholder-[var(--foreground-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
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
                  <div className="p-3 bg-[var(--warning-subtle)] rounded-lg border border-[var(--warning)] space-y-2">
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
            >
              Continue
            </Button>
          </div>
        ) : (
          <TransactionFlow
            onSuccessComplete={handleSuccessComplete}
            onReturnToIdle={tx.handleResetToIdle}
          />
        )}
      </div>
    </Modal>
  );
}
