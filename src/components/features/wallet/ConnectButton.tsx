'use client';

import { useEffect, useCallback, useState } from 'react';
import { useConnection } from 'wagmi';
import { useAppKit } from '@reown/appkit/react';
import { useAdvisoryAgreement } from '@/contexts/AdvisoryAgreementContext';
import { useWalletDisplayName } from '@/hooks/useWalletDisplayName';
import { useIsClient } from '@/hooks/useClientOnly';
import { BASE_CHAIN_ID } from '@/lib/constants';
import { ensureAppKitInit } from '@/lib/appkit-init';
import { logger } from '@/lib/logger';
import { preloadWalletSdks } from '@/lib/lazy-connectors';

const buttonClassName =
  'inline-flex items-center justify-center px-3 py-1.5 text-sm gap-1.5 text-[var(--foreground)] transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--border)] rounded-md hover:bg-[var(--surface-hover)] active:bg-[var(--surface-active)] cursor-pointer';

function ConnectButtonShell({
  children,
  ready,
}: {
  children: React.ReactNode;
  ready: boolean;
}) {
  return (
    <div
      {...(!ready && {
        'aria-hidden': true,
        style: {
          opacity: 0,
          pointerEvents: 'none',
          userSelect: 'none',
        },
      })}
    >
      {children}
    </div>
  );
}

function ConnectButtonReady() {
  const { isAccepted, openModal, shouldOpenWalletConnect, clearWalletConnectFlag } =
    useAdvisoryAgreement();
  const { open } = useAppKit();
  // The wallet's real chain. useChainId() only reports configured chains, so with a
  // Base-only config it stays 8453 and the Wrong network button would never show.
  const { address, isConnected, chainId } = useConnection();
  const isClient = useIsClient();
  const { displayName } = useWalletDisplayName(address);

  const connectWallet = useCallback(async () => {
    await ensureAppKitInit();
    try {
      await open({ view: 'Connect' });
    } catch (err) {
      logger.warn('Reown AppKit failed to open', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, [open]);

  useEffect(() => {
    if (!shouldOpenWalletConnect || !isAccepted || !isClient || isConnected) return;

    const timer = window.setTimeout(() => {
      clearWalletConnectFlag();
      void connectWallet();
    }, 400);

    return () => window.clearTimeout(timer);
  }, [
    shouldOpenWalletConnect,
    isAccepted,
    isClient,
    isConnected,
    clearWalletConnectFlag,
    connectWallet,
  ]);

  const handleConnectClick = () => {
    preloadWalletSdks();
    if (!isAccepted) {
      openModal();
    } else {
      void connectWallet();
    }
  };

  const openAppKitView = useCallback(
    async (view: 'Networks' | 'Account') => {
      await ensureAppKitInit();
      await open({ view });
    },
    [open]
  );

  const wrongNetwork = isConnected && chainId !== BASE_CHAIN_ID;

  return (
    <ConnectButtonShell ready={isClient}>
      {!isConnected ? (
        <button onClick={handleConnectClick} type="button" className={buttonClassName}>
          Connect Wallet
        </button>
      ) : wrongNetwork ? (
        <button
          onClick={() => void openAppKitView('Networks')}
          type="button"
          className={buttonClassName}
        >
          Wrong network
        </button>
      ) : (
        <button
          onClick={() => void openAppKitView('Account')}
          type="button"
          className={buttonClassName}
        >
          {displayName}
        </button>
      )}
    </ConnectButtonShell>
  );
}

export default function ConnectButtonComponent() {
  const [appKitReady, setAppKitReady] = useState(false);
  const isClient = useIsClient();

  useEffect(() => {
    void ensureAppKitInit().then(() => setAppKitReady(true));
  }, []);

  if (!appKitReady) {
    return (
      <ConnectButtonShell ready={isClient}>
        <button type="button" className={buttonClassName}>
          Connect Wallet
        </button>
      </ConnectButtonShell>
    );
  }

  return <ConnectButtonReady />;
}
