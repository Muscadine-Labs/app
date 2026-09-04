'use client';

import React, { useEffect, useCallback } from 'react';
import { useAccount, useConnect, useChainId } from 'wagmi';
import { useAppKit } from '@reown/appkit/react';
import { useAdvisoryAgreement } from '@/contexts/AdvisoryAgreementContext';
import { useWalletDisplayName } from '@/hooks/useWalletDisplayName';
import { useIsClient } from '@/hooks/useClientOnly';
import { isBaseAppWebView, pickBaseAppConnector } from '@/lib/base-app';
import { BASE_CHAIN_ID } from '@/lib/constants';
import { logger } from '@/lib/logger';

const buttonClassName =
  'inline-flex items-center justify-center px-3 py-1.5 text-sm gap-1.5 text-[var(--foreground)] transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--border)] rounded-md hover:bg-[var(--surface-hover)] active:bg-[var(--surface-active)] cursor-pointer';

export default function ConnectButtonComponent() {
    const { isAccepted, openModal, shouldOpenWalletConnect, clearWalletConnectFlag } = useAdvisoryAgreement();
    const { connectAsync, connectors } = useConnect();
    const { open } = useAppKit();
    const { address, isConnected } = useAccount();
    const chainId = useChainId();
    const isClient = useIsClient();
    const { displayName } = useWalletDisplayName(address);

    const connectWallet = useCallback(async () => {
        if (isBaseAppWebView()) {
            const connector = pickBaseAppConnector(connectors);
            if (connector) {
                try {
                    await connectAsync({ connector });
                    return;
                } catch (err) {
                    logger.warn('Base App injected connect failed; opening Reown AppKit', {
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            }
        }
        try {
            await open({ view: 'Connect' });
        } catch (err) {
            logger.warn('Reown AppKit failed to open', {
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }, [connectors, connectAsync, open]);

    // Auto-open wallet connect after advisory modal closes (defer to avoid WC modal reset race).
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
        if (!isAccepted) {
            openModal();
        } else {
            void connectWallet();
        }
    };

    const ready = isClient;
    const wrongNetwork = isConnected && chainId !== BASE_CHAIN_ID;

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
            {!isConnected ? (
                <button
                    onClick={handleConnectClick}
                    type="button"
                    className={buttonClassName}
                >
                    Connect Wallet
                </button>
            ) : wrongNetwork ? (
                <button
                    onClick={() => void open({ view: 'Networks' })}
                    type="button"
                    className={buttonClassName}
                >
                    Wrong network
                </button>
            ) : (
                <button
                    onClick={() => void open({ view: 'Account' })}
                    type="button"
                    className={buttonClassName}
                >
                    {displayName}
                </button>
            )}
        </div>
    );
}
