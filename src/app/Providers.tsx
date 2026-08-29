'use client'

import { ReactNode, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider } from 'wagmi'
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit'
import { config } from '@/config/wagmi'
import { base } from 'wagmi/chains'
import '@rainbow-me/rainbowkit/styles.css'
import { VaultDataProvider } from '../contexts/VaultDataContext'
import { WalletProvider } from '../contexts/WalletContext'
import { TransactionProvider } from '../contexts/TransactionContext'
import { ToastProvider } from '../contexts/ToastContext'
import { ThemeProvider } from '../contexts/ThemeContext'
import { AdvisoryAgreementProvider } from '../contexts/AdvisoryAgreementContext'
import { ErrorBoundary } from '../components/common/ErrorBoundary'
import { AdvisoryAgreementModal } from '../components/features/wallet/AdvisoryAgreementModal'
import { logger } from '../lib/logger'

type Props = {
  children: ReactNode
  initialState?: Parameters<typeof WagmiProvider>[0]['initialState']
}

export function Providers({ children, initialState }: Props) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      })
  )

  return (
    <ErrorBoundary
      onError={(error, errorInfo) => {
        logger.error('Providers error boundary caught error', error, {
          componentStack: errorInfo.componentStack,
        });
      }}
    >
      <WagmiProvider
        config={config}
        initialState={initialState} // undefined in dev is fine
        reconnectOnMount={true} // Automatically reconnect on mount (page reload) - defaults to true but explicit for clarity
      >
        <QueryClientProvider client={queryClient}>
          <RainbowKitProvider
            initialChain={base}
            theme={darkTheme({
              accentColor: 'var(--primary)',
              accentColorForeground: 'white',
              borderRadius: 'medium',
              fontStack: 'system',
              overlayBlur: 'small',
            })}
          >
            <ThemeProvider>
              <AdvisoryAgreementProvider>
                <ToastProvider>
                  <WalletProvider>
                    <VaultDataProvider>
                      <TransactionProvider>
                        <AdvisoryAgreementModal />
                        {children}
                      </TransactionProvider>
                    </VaultDataProvider>
                  </WalletProvider>
                </ToastProvider>
              </AdvisoryAgreementProvider>
            </ThemeProvider>
          </RainbowKitProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </ErrorBoundary>
  )
}
