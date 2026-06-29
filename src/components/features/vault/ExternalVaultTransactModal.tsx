'use client';

import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui';

interface ExternalVaultTransactModalProps {
  isOpen: boolean;
  onClose: () => void;
  morphoVaultUrl: string;
  action: 'deposit' | 'withdraw';
}

export function ExternalVaultTransactModal({
  isOpen,
  onClose,
  morphoVaultUrl,
  action,
}: ExternalVaultTransactModalProps) {
  const actionLabel = action === 'deposit' ? 'deposit into' : 'withdraw from';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="External vault"
      closeOnOverlayClick
    >
      <div className="space-y-4">
        <p className="text-sm text-[var(--foreground)] leading-relaxed">
          This vault is not managed on Muscadine. You cannot {actionLabel} this vault here.
        </p>
        <p className="text-sm text-[var(--foreground-secondary)] leading-relaxed">
          To {action}, use the Morpho app for this vault.
        </p>
        <div className="flex flex-col gap-2 pt-2">
          <Button
            variant="primary"
            size="lg"
            fullWidth
            onClick={() => window.open(morphoVaultUrl, '_blank', 'noopener,noreferrer')}
          >
            Continue on Morpho
          </Button>
          <Button variant="secondary" size="lg" fullWidth onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}
