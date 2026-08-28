'use client';

import { Button } from '@/components/ui';

interface VaultActionCardProps {
  onDeposit: () => void;
  onWithdraw: () => void;
}

/** Compact desktop CTA beside the vault chart. Opens the transact modal. */
export function VaultActionCard({ onDeposit, onWithdraw }: VaultActionCardProps) {
  return (
    <div className="w-full h-full min-h-[13rem] rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-4 flex flex-col justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-[var(--foreground)]">Manage</p>
        <p className="text-xs text-[var(--foreground-secondary)] mt-1 leading-relaxed">
          Deposit or withdraw from this vault.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Button onClick={onDeposit} variant="primary" size="md" fullWidth>
          Deposit
        </Button>
        <Button onClick={onWithdraw} variant="secondary" size="md" fullWidth>
          Withdraw
        </Button>
      </div>
    </div>
  );
}
