'use client';

import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui';

interface WithdrawLiquidityWarningModalProps {
  isOpen: boolean;
  onClose: () => void;
  onContinue: () => void;
  morphoVaultUrl: string;
  requestedAmountLabel: string;
  instantLiquidityLabel: string;
}

export function WithdrawLiquidityWarningModal({
  isOpen,
  onClose,
  onContinue,
  morphoVaultUrl,
  requestedAmountLabel,
  instantLiquidityLabel,
}: WithdrawLiquidityWarningModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Forced deallocation may be required"
      closeOnOverlayClick
    >
      <div className="space-y-4">
        <p className="text-sm text-[var(--foreground)] leading-relaxed">
          You&apos;re withdrawing <span className="font-medium">{requestedAmountLabel}</span>, but
          only <span className="font-medium">{instantLiquidityLabel}</span>
          {' is '}available without forced deallocation — liquidity still in markets must be moved
          back to idle first. Muscadine doesn&apos;t support forced deallocation yet.
        </p>
        <p className="text-sm text-[var(--foreground-secondary)] leading-relaxed">
          Complete this withdrawal on Morpho, or try continuing here.
        </p>
        <div className="flex flex-col gap-2 pt-2">
          <Button
            variant="primary"
            size="lg"
            fullWidth
            onClick={() => window.open(morphoVaultUrl, '_blank', 'noopener,noreferrer')}
          >
            Open vault on Morpho
          </Button>
          <Button variant="secondary" size="lg" fullWidth onClick={onContinue}>
            Continue anyway
          </Button>
          <Button variant="secondary" size="lg" fullWidth onClick={onClose}>
            Go back
          </Button>
        </div>
      </div>
    </Modal>
  );
}
