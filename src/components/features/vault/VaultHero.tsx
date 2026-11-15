'use client';

import Image from 'next/image';
import { useTokenLogo } from '@/contexts/PriceContext';
import { useToast } from '@/contexts/ToastContext';
import { MorphoVaultData } from '@/types/vault';

interface VaultHeroProps {
  vaultData: MorphoVaultData;
}

export default function VaultHero({ vaultData }: VaultHeroProps) {
  const logo = useTokenLogo(vaultData.symbol);
  const { showToast, error: showErrorToast } = useToast();

  const handleCopyAddress = async () => {
    try {
      await navigator.clipboard.writeText(vaultData.address);
      showToast('Copied to clipboard', 'neutral', 2000);
    } catch {
      showErrorToast('Failed to copy to clipboard', 5000);
    }
  };

  return (
    <div className="w-full">
      <div className="min-w-0">
        <h1
          onClick={handleCopyAddress}
          className="flex items-center gap-2 min-w-0 text-2xl sm:text-3xl md:text-4xl font-semibold text-[var(--foreground)] cursor-pointer hover:text-[var(--primary)] transition-colors duration-200 select-none"
          title={`Click to copy address: ${vaultData.address}`}
        >
          <span className="break-words">{vaultData.name}</span>
        </h1>
        <div className="flex items-center gap-2 mt-1">
          <div className="w-5 h-5 rounded-full bg-white flex items-center justify-center overflow-hidden shrink-0">
            <Image
              src={logo}
              alt={`${vaultData.symbol} logo`}
              width={20}
              height={20}
              className="w-full h-full object-contain"
            />
          </div>
          <span className="text-sm sm:text-base text-[var(--foreground-secondary)]">
            {vaultData.vaultSymbol || vaultData.symbol}
          </span>
        </div>
      </div>
    </div>
  );
}
