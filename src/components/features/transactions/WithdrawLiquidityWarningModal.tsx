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
      title="Withdrawal may exceed instant liquidity"
      closeOnOverlayClick
    >
      <div className="space-y-4">
        <p className="text-sm text-[var(--foreground)] leading-relaxed">
          You are withdrawing <span className="font-medium">{requestedAmountLabel}</span>, but
          only about <span className="font-medium">{instantLiquidityLabel}</span> is available
          for instant exit (idle + liquidity adapter). The rest may require a force exit on
          Morpho, which can include a curator penalty.
        </p>
        <p className="text-sm text-[var(--foreground-secondary)] leading-relaxed">
          You can try continuing here, or withdraw on Morpho where force exit is supported.
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
