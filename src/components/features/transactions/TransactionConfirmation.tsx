'use client';

import type { Address } from 'viem';
import { Account, VaultAccount, getVaultLogo } from '@/types/vault';
import { TransactionType, useTransactionState } from '@/contexts/TransactionContext';
import { formatAssetBalance, formatCurrency, truncateAddress } from '@/lib/formatter';
import {
  BASE_CHAIN_ID,
  ETH_GAS_RESERVE,
  MORPHO_DISCLAIMER_URL,
  getChainDisplayName,
} from '@/lib/constants';
import { findVaultByAddress } from '@/lib/vault-utils';
import { isWethVault } from '@/lib/transaction-form-utils';
import { Button } from '@/components/ui';
import { useAccount } from 'wagmi';
import { useRouter } from 'next/navigation';
import { TransactionProgressBar } from './TransactionProgressBar';
import { useToast } from '@/contexts/ToastContext';
import { useVaultData } from '@/contexts/VaultDataContext';
import { useWallet } from '@/contexts/WalletContext';
import { usePrices } from '@/contexts/PriceContext';
import { logger } from '@/lib/logger';

function resolveVaultDisplay(account: VaultAccount) {
  const registry = findVaultByAddress(account.address);
  return {
    name: registry?.name ?? account.name,
    address: account.address,
    shareSymbol: registry?.vaultSymbol ?? null,
    chainName: getChainDisplayName(registry?.chainId ?? BASE_CHAIN_ID),
  };
}

function partyTitle(account: Account): string {
  if (account.type === 'wallet') return 'Wallet';
  return resolveVaultDisplay(account as VaultAccount).name;
}

function partySubtitle(account: Account, walletAddress?: string): string {
  const chainName = getChainDisplayName(BASE_CHAIN_ID);
  if (account.type === 'wallet') {
    const short = walletAddress ? truncateAddress(walletAddress as Address) : null;
    return short ? `${short} · ${chainName}` : chainName;
  }
  const vault = resolveVaultDisplay(account as VaultAccount);
  const share = vault.shareSymbol ? `${vault.shareSymbol} · ` : '';
  return `${share}${vault.chainName}`;
}

function partyCopyValue(account: Account, walletAddress?: string): string | null {
  if (account.type === 'wallet') return walletAddress ?? null;
  return (account as VaultAccount).address;
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

function PartyAvatar({ symbol, alt }: { symbol: string; alt: string }) {
  return (
    <div className="w-11 h-11 rounded-full bg-white flex items-center justify-center shrink-0 border border-[var(--border-subtle)] p-2">
      {/* SVGs stay vector-sharp as <img>; next/image rasterizes them. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={getVaultLogo(symbol)} alt={alt} className="w-7 h-7 object-contain" />
    </div>
  );
}

function PartyRow({
  label,
  account,
  walletAddress,
  assetSymbol,
  amount,
  amountUsd,
  amountTone,
  onCopy,
}: {
  label: string;
  account: Account;
  walletAddress?: string;
  assetSymbol: string;
  amount: string;
  amountUsd: number;
  amountTone: 'debit' | 'credit';
  onCopy: (value: string, name: string) => void;
}) {
  const title = partyTitle(account);
  const copyValue = partyCopyValue(account, walletAddress);
  const showUsd = amountUsd > 0;

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <PartyAvatar symbol={assetSymbol} alt={title} />
        <div className="flex-1 min-w-0">
          <p className="text-[10px] md:text-xs text-[var(--foreground-secondary)] uppercase tracking-wide">
            {label}
          </p>
          {copyValue ? (
            <button
              type="button"
              onClick={() => onCopy(copyValue, title)}
              className="text-left cursor-pointer hover:text-[var(--primary)] transition-colors duration-200 w-full min-w-0"
              title={`Click to copy: ${copyValue}`}
            >
              <p className="text-sm md:text-base font-semibold text-[var(--foreground)] truncate">
                {title}
              </p>
            </button>
          ) : (
            <p className="text-sm md:text-base font-semibold text-[var(--foreground)] truncate">
              {title}
            </p>
          )}
          <p className="text-xs text-[var(--foreground-secondary)] truncate">
            {partySubtitle(account, walletAddress)}
          </p>
        </div>
      </div>
      <div className="text-right shrink-0">
        <p
          className={`text-base md:text-lg font-semibold tabular-nums ${
            amountTone === 'debit' ? 'text-[var(--danger)]' : 'text-[var(--success)]'
          }`}
        >
          {amountTone === 'debit' ? '-' : '+'}
          {amount}
        </p>
        {showUsd ? (
          <p className="text-xs text-[var(--foreground-secondary)] tabular-nums">
            {formatCurrency(amountUsd)}
          </p>
        ) : null}
      </div>
    </div>
  );
}

interface TransactionConfirmationProps {
  fromAccount: Account;
  toAccount: Account;
  amount: string;
  assetSymbol: string;
  assetDecimals?: number;
  transactionType: TransactionType | null;
  isLoading: boolean;
  progressSteps?: Array<{ label: string; completed: boolean; active: boolean }>;
  showProgress?: boolean;
  isSuccess?: boolean;
  isPartialFailure?: boolean;
  errorMessage?: string;
  txHash?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  /** When set, success completion uses this instead of staying on the confirmation screen. */
  onSuccessComplete?: () => void;
  /** Softer layout when rendered inside the vault transact modal. */
  embedded?: boolean;
}

export function TransactionConfirmation({
  fromAccount,
  toAccount,
  amount,
  assetSymbol,
  assetDecimals,
  transactionType,
  isLoading,
  progressSteps = [],
  showProgress = false,
  isSuccess = false,
  isPartialFailure = false,
  errorMessage,
  txHash,
  onCancel,
  onConfirm,
  onSuccessComplete,
  embedded = false,
}: TransactionConfirmationProps) {
  const { address } = useAccount();
  const router = useRouter();
  const { reset, preferredAsset } = useTransactionState();
  const { btc: btcPrice, eth: ethPrice } = usePrices();
  const { error: showErrorToast, showToast } = useToast();
  const { fetchVaultData } = useVaultData();
  const { refreshBalances } = useWallet();

  const handleDone = async () => {
    if (isSuccess) {
      // Refresh all data to ensure fresh values
      try {
        // Refresh wallet balances (includes Morpho positions)
        await refreshBalances();
        
        // Refresh vault data for any vaults involved in the transaction (force refresh to bypass cache)
        if (fromAccount.type === 'vault') {
          const vaultAddress = (fromAccount as VaultAccount).address;
          await fetchVaultData(vaultAddress, BASE_CHAIN_ID, true);
        }
        if (toAccount.type === 'vault') {
          const vaultAddress = (toAccount as VaultAccount).address;
          await fetchVaultData(vaultAddress, BASE_CHAIN_ID, true);
        }
        
        // Force Next.js to refresh server-side data
        router.refresh();
      } catch (error) {
        logger.error('Error refreshing data after transaction', error instanceof Error ? error : new Error(String(error)), {
          fromAccount: fromAccount.type === 'vault' ? (fromAccount as VaultAccount).address : 'wallet',
          toAccount: toAccount.type === 'vault' ? (toAccount as VaultAccount).address : 'wallet',
        });
        // Continue with reset even if refresh fails
      }
      
      reset();
      if (onSuccessComplete) {
        onSuccessComplete();
      }
    } else {
      onCancel();
    }
  };

  const getTransactionTypeLabel = () => {
    if (transactionType === 'deposit') return 'Deposit';
    if (transactionType === 'withdraw') return 'Withdraw';
    return 'Transaction';
  };

  const formatAmount = () => {
    if (!amount || amount === '') {
      return `0.00 ${assetSymbol}`;
    }
    
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount)) {
      return `0.00 ${assetSymbol}`;
    }
    
    return formatAssetBalance(amount, assetSymbol, assetDecimals, true);
  };

  const formattedAmount = formatAmount();
  const amountUsd = amountUsdValue(amount, assetSymbol, btcPrice, ethPrice);

  const showEthGasReserveNote =
    transactionType === 'deposit' &&
    assetSymbol === 'WETH' &&
    fromAccount.type === 'wallet' &&
    toAccount.type === 'vault' &&
    isWethVault((toAccount as VaultAccount).address, assetSymbol) &&
    (preferredAsset === 'ETH' || preferredAsset === 'ALL');

  // Get current date for transaction details
  const getCurrentDate = () => {
    const now = new Date();
    return now.toLocaleDateString('en-US', { 
      month: '2-digit', 
      day: '2-digit', 
      year: 'numeric' 
    });
  };

  const handleCopyValue = async (value: string, name: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      if (name === 'Transaction hash') {
        showToast('Copied! View on', 'neutral', 3000, `https://basescan.org/tx/${value}`, 'Basescan');
      } else {
        showToast(`${name} copied to clipboard`, 'neutral', 2000);
      }
    } catch (err) {
      logger.error('Failed to copy', err instanceof Error ? err : new Error(String(err)), { value, name });
      showErrorToast('Failed to copy to clipboard', 5000);
    }
  };

  const transferCard = (
    <div className={embedded
      ? 'bg-white dark:bg-[var(--surface-elevated)] rounded-xl border border-[var(--border-subtle)] p-4 space-y-3'
      : 'bg-white dark:bg-[var(--surface-elevated)] rounded-xl border border-[var(--border-subtle)] p-4 md:p-5 space-y-3 md:space-y-4'}>
      <PartyRow
        label="From"
        account={fromAccount}
        walletAddress={address}
        assetSymbol={assetSymbol}
        amount={formattedAmount}
        amountUsd={amountUsd}
        amountTone="debit"
        onCopy={handleCopyValue}
      />
      <div className="flex justify-center py-0.5">
        <div className="w-8 h-8 rounded-full bg-[var(--background)] flex items-center justify-center border border-[var(--border-subtle)]">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-4 h-4 text-[var(--foreground-secondary)]"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <polyline points="19 12 12 19 5 12" />
          </svg>
        </div>
      </div>
      <PartyRow
        label="To"
        account={toAccount}
        walletAddress={address}
        assetSymbol={assetSymbol}
        amount={formattedAmount}
        amountUsd={amountUsd}
        amountTone="credit"
        onCopy={handleCopyValue}
      />
    </div>
  );

  if (isSuccess) {
    // Success state - Payment confirmation style
    return (
      <div className={embedded
        ? 'space-y-4'
        : 'bg-[var(--surface)] rounded-lg border border-[var(--border-subtle)] p-8'}>
        {!embedded && (
          <h2 className="text-2xl font-semibold text-[var(--foreground)] text-center mb-2">
            Transaction confirmed
          </h2>
        )}

        <div className="mb-6 space-y-4">
          {transferCard}
          <div className="space-y-2 px-0.5">
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-[var(--foreground-secondary)]">Date</p>
              <p className="text-sm font-medium text-[var(--foreground)]">{getCurrentDate()}</p>
            </div>
            {txHash ? (
              <div className="flex items-start justify-between gap-4">
                <p className="text-sm text-[var(--foreground-secondary)] shrink-0">Tx hash</p>
                <button
                  type="button"
                  onClick={() => handleCopyValue(txHash, 'Transaction hash')}
                  className="text-sm font-medium text-[var(--foreground)] hover:text-[var(--primary)] transition-colors break-all text-right cursor-pointer"
                  title="Click to copy"
                >
                  {truncateAddress(txHash as Address, 10, 8)}
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {/* New Transaction / Done */}
        <Button
          onClick={handleDone}
          variant="primary"
          size="lg"
          fullWidth
          className={`min-h-11 touch-manipulation ${embedded ? '' : 'mb-4'}`}
        >
          {embedded ? 'Done' : 'New Transaction'}
        </Button>

        {!embedded && (
          <Button
            onClick={() => {
              reset();
              router.push('/');
            }}
            variant="secondary"
            size="lg"
            fullWidth
          >
            Back to Dashboard
          </Button>
        )}
      </div>
    );
  }

  // Preview/Confirm state - Original design
  return (
    <div className={embedded
      ? 'space-y-4'
      : 'bg-[var(--surface)] rounded-lg border border-[var(--border-subtle)] p-4 md:p-6 space-y-4 md:space-y-6'}>
      {/* Header — hidden in embedded modal (title is in Modal chrome) */}
      {!embedded && (
        <div className="flex items-start md:items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="text-lg md:text-xl font-semibold text-[var(--foreground)]">Confirm Transaction</h3>
            <p className="text-xs md:text-sm text-[var(--foreground-secondary)] mt-0.5 md:mt-1">
              Review the details before confirming
            </p>
          </div>
          <div className="px-2 py-1 md:px-3 md:py-1.5 bg-[var(--primary-subtle)] rounded-lg shrink-0">
            <span className="text-xs md:text-sm font-medium text-[var(--primary)]">
              {getTransactionTypeLabel()}
            </span>
          </div>
        </div>
      )}

      {transferCard}

      {/* Note for WETH deposits with ETH wrapping */}
      {transactionType === 'deposit' &&
        assetSymbol === 'WETH' &&
        fromAccount.type === 'wallet' &&
        showEthGasReserveNote && (
        <div className="flex items-start gap-2 md:gap-3 p-3 md:p-4 bg-[var(--info-subtle)] rounded-lg border border-[var(--info)]">
          <div className="w-4 h-4 md:w-5 md:h-5 rounded-full bg-[var(--info)] flex items-center justify-center shrink-0 mt-0.5">
            <svg className="w-2.5 h-2.5 md:w-3 md:h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-xs md:text-sm text-[var(--foreground)]">
            <span className="font-medium">Note:</span> Depositing ETH uses Morpho Bundler3 to wrap
            to WETH and deposit in one confirmation. {ETH_GAS_RESERVE} ETH is intentionally left in
            your wallet for network gas fees.
          </p>
        </div>
      )}

      {/* Note for WETH vault withdrawals that unwrap to native ETH */}
      {transactionType === 'withdraw' &&
        assetSymbol === 'WETH' &&
        fromAccount.type === 'vault' &&
        toAccount.type === 'wallet' &&
        isWethVault((fromAccount as VaultAccount).address, assetSymbol) &&
        preferredAsset === 'ETH' && (
        <div className="flex items-start gap-2 md:gap-3 p-3 md:p-4 bg-[var(--info-subtle)] rounded-lg border border-[var(--info)]">
          <div className="w-4 h-4 md:w-5 md:h-5 rounded-full bg-[var(--info)] flex items-center justify-center shrink-0 mt-0.5">
            <svg className="w-2.5 h-2.5 md:w-3 md:h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-xs md:text-sm text-[var(--foreground)]">
            <span className="font-medium">Note:</span> Withdrawing to ETH uses Morpho Bundler3 to
            exit the vault and unwrap WETH in one confirmation (share approval may be required
            first). Force withdraw is separate: vault exit, then a Bundler3 unwrap.
          </p>
        </div>
      )}

      {/* Disclaimer */}
      <div className="pt-3 md:pt-4 border-t border-[var(--border-subtle)]">
        <p className="text-[10px] md:text-xs text-[var(--foreground-secondary)] leading-relaxed">
          By confirming this transaction, you agree to the{' '}
          <a
            href="https://muscadine.xyz/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--primary)] hover:underline"
          >
            Terms of Use
          </a>
          {', '}
          <a
            href="https://muscadine.xyz/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--primary)] hover:underline"
          >
            Privacy Policy
          </a>
          {', and '}
          <a
            href={MORPHO_DISCLAIMER_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--primary)] hover:underline"
          >
            Morpho’s Disclaimer
          </a>
          .
        </p>
      </div>

      {isPartialFailure && errorMessage && (
        <div className="flex items-start gap-2 md:gap-3 p-3 md:p-4 bg-[var(--danger-subtle)] rounded-lg border border-[var(--danger)]">
          <div className="w-4 h-4 md:w-5 md:h-5 rounded-full bg-[var(--danger)] flex items-center justify-center shrink-0 mt-0.5">
            <svg className="w-2.5 h-2.5 md:w-3 md:h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <p className="text-xs md:text-sm text-[var(--foreground)] whitespace-pre-line">{errorMessage}</p>
        </div>
      )}

      {/* Progress Bar - Show at bottom when transaction is in progress or retrying a failed step */}
      {showProgress && progressSteps.length > 0 && (
        <div className="pt-3 md:pt-4 border-t border-[var(--border-subtle)]">
          <TransactionProgressBar steps={progressSteps} isSuccess={isSuccess} />
        </div>
      )}

      {/* Action Buttons */}
      <div className={`flex gap-2 md:gap-3 pt-2 ${embedded ? 'flex-col-reverse sm:flex-row' : ''}`}>
        {isSuccess ? (
          <Button
            onClick={onCancel}
            variant="primary"
            size="lg"
            fullWidth
            className="min-h-11 touch-manipulation"
          >
            Done
          </Button>
        ) : (
          <>
            <Button
              onClick={onCancel}
              disabled={isLoading}
              variant="secondary"
              size="lg"
              fullWidth
              className="min-h-11 touch-manipulation"
            >
              {isPartialFailure ? 'Start over' : 'Cancel'}
            </Button>
            <Button
              onClick={onConfirm}
              disabled={isLoading || (!isPartialFailure && (!amount || parseFloat(amount) <= 0))}
              variant="primary"
              size="lg"
              fullWidth
              className="min-h-11 touch-manipulation"
            >
              {isLoading ? 'Processing...' : isPartialFailure ? 'Try again' : 'Confirm'}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

