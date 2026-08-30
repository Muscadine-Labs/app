'use client';

import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui';
import { MORPHO_FORCE_DEALLOCATE_DOCS_URL } from '@/lib/constants';

interface WithdrawLiquidityWarningModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Run in-app force withdraw (forceDeallocate + withdraw). */
  onForceWithdraw?: () => void;
  morphoVaultUrl: string;
  requestedAmountLabel: string;
  instantLiquidityLabel: string;
  /** Simulated penalty burned from shares (asset units), e.g. "0.00000037 cbBTC". */
  estimatedPenaltyLabel?: string | null;
  /** Penalty rate display, e.g. "0.0001%". */
  penaltyRateLabel?: string | null;
  /** Expected assets after penalty haircut on the illiquid shortfall. */
  expectedOutLabel?: string | null;
  /** True when we built + simulated a force-withdraw plan. */
  forceWithdrawAvailable?: boolean;
  /** True when MAX force exit falls back to withdraw (not redeem) and may leave share dust. */
  mayLeaveShareDust?: boolean;
  isPreparingForce?: boolean;
}

export function WithdrawLiquidityWarningModal({
  isOpen,
  onClose,
  onForceWithdraw,
  morphoVaultUrl,
  requestedAmountLabel,
  instantLiquidityLabel,
  estimatedPenaltyLabel,
  penaltyRateLabel,
  expectedOutLabel,
  forceWithdrawAvailable = false,
  mayLeaveShareDust = false,
  isPreparingForce = false,
}: WithdrawLiquidityWarningModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Forced withdrawal required"
      showCloseButton={!isPreparingForce}
      closeOnOverlayClick={!isPreparingForce}
      closeOnEscape={!isPreparingForce}
    >
      <div className="space-y-4">
        <p className="text-sm text-[var(--foreground)] leading-relaxed">
          You&apos;re withdrawing <span className="font-medium">{requestedAmountLabel}</span>, but
          only <span className="font-medium">{instantLiquidityLabel}</span> is available instantly.
          The rest must be force-deallocated first.{' '}
          <a
            href={MORPHO_FORCE_DEALLOCATE_DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--primary)] hover:underline"
          >
            What is force deallocation?
          </a>
        </p>

        {forceWithdrawAvailable ? (
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)]/60 p-3 space-y-2">
            <p className="text-xs font-medium text-[var(--foreground-secondary)] uppercase tracking-wide">
              Estimated penalty
            </p>
            <p className="text-sm text-[var(--foreground)]">
              <span className="font-medium">{estimatedPenaltyLabel ?? '—'}</span>
              {penaltyRateLabel ? (
                <span className="text-[var(--foreground-secondary)]"> ({penaltyRateLabel})</span>
              ) : null}
            </p>
            {expectedOutLabel ? (
              <p className="text-xs text-[var(--foreground-secondary)]">
                Expected about{' '}
                <span className="font-medium text-[var(--foreground)]">{expectedOutLabel}</span> after
                penalty.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-[var(--foreground-secondary)] leading-relaxed">
            In-app force withdraw isn&apos;t available right now. Open Morpho to exit, or go back and
            try a smaller amount.
          </p>
        )}

        <div className="rounded-lg border border-[var(--warning)]/50 bg-[var(--warning-subtle)] p-3 space-y-2">
          <p className="text-xs font-medium text-[var(--foreground)]">Risks</p>
          <ul className="text-xs text-[var(--foreground-secondary)] leading-relaxed list-disc pl-4 space-y-1">
            <li>Penalty is burned from your shares; the estimate can change if share price moves.</li>
            <li>If markets lack free liquidity, the transaction reverts.</li>
            {mayLeaveShareDust ? (
              <li>
                A small amount of vault share dust may remain because this force exit uses withdraw,
                not redeem.
              </li>
            ) : null}
          </ul>
        </div>

        <div className="flex flex-col gap-2 pt-1">
          {forceWithdrawAvailable && onForceWithdraw ? (
            <Button
              variant="primary"
              size="lg"
              fullWidth
              disabled={isPreparingForce}
              onClick={onForceWithdraw}
            >
              {isPreparingForce ? 'Preparing…' : 'Force withdraw'}
            </Button>
          ) : null}
          <Button
            variant={forceWithdrawAvailable ? 'secondary' : 'primary'}
            size="lg"
            fullWidth
            disabled={isPreparingForce}
            onClick={() => window.open(morphoVaultUrl, '_blank', 'noopener,noreferrer')}
          >
            Open vault on Morpho
          </Button>
          <Button variant="secondary" size="lg" fullWidth disabled={isPreparingForce} onClick={onClose}>
            Go back
          </Button>
        </div>
      </div>
    </Modal>
  );
}
