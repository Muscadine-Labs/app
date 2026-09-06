'use client'

import { ReactNode, useState, useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider } from 'wagmi'
import { config } from '@/config/wagmi'
import { useAppKitTheme } from '@reown/appkit/react'
import { ensureAppKitInit } from '@/lib/appkit-init'
import { VaultDataProvider } from '../contexts/VaultDataContext'
import { WalletProvider } from '../contexts/WalletContext'
import { TransactionProvider } from '../contexts/TransactionContext'
import { ToastProvider } from '../contexts/ToastContext'
import { ThemeProvider, useTheme } from '../contexts/ThemeContext'
import { AdvisoryAgreementProvider } from '../contexts/AdvisoryAgreementContext'
import { ErrorBoundary } from '../components/common/ErrorBoundary'
import { AdvisoryAgreementModal } from '../components/features/wallet/AdvisoryAgreementModal'
import { logger } from '../lib/logger'

type Props = {
  children: ReactNode
  initialState?: Parameters<typeof WagmiProvider>[0]['initialState']
}

function AppKitThemeSyncInner() {
  const { effectiveTheme } = useTheme()
  const { setThemeMode } = useAppKitTheme()

  useEffect(() => {
    setThemeMode(effectiveTheme)
  }, [effectiveTheme, setThemeMode])

  return null
}

function AppKitThemeSync() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    void ensureAppKitInit().then(() => setReady(true))
  }, [])

  if (!ready) return null
  return <AppKitThemeSyncInner />
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
          <ThemeProvider>
            <AppKitThemeSync />
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
        </QueryClientProvider>
      </WagmiProvider>
    </ErrorBoundary>
  )
}
