'use client'

import { ReactNode, useState, useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { hydrate } from '@wagmi/core'
import { WagmiProvider } from 'wagmi'
import { config } from '@/config/wagmi'
import { useAppKitTheme } from '@reown/appkit/react'
import { ensureAppKitInit } from '@/lib/appkit-init'
import { VaultDataProvider } from '../contexts/VaultDataContext'
import { WalletProvider } from '../contexts/WalletContext'
import { ExplorerVaultsProvider } from '../contexts/ExplorerVaultsContext'
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

function WagmiBoundary({
  children,
  initialState,
}: {
  children: ReactNode
  initialState: Props['initialState']
}) {
  // Apply the cookie snapshot once, before any subscriber mounts. Passing it to
  // WagmiProvider instead repeats config.setState on every render until persist
  // finishes, which updates useAccount subscribers (VaultV2Page) during Hydrate's render.
  useState(() => {
    if (initialState) hydrate(config, { initialState, reconnectOnMount: true })
    return null
  })

  return (
    <WagmiProvider config={config} reconnectOnMount>
      {children}
    </WagmiProvider>
  )
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
      <WagmiBoundary initialState={initialState}>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <AppKitThemeSync />
            <AdvisoryAgreementProvider>
                <ToastProvider>
                  <WalletProvider>
                    <ExplorerVaultsProvider>
                      <VaultDataProvider>
                        <TransactionProvider>
                          <AdvisoryAgreementModal />
                          {children}
                        </TransactionProvider>
                      </VaultDataProvider>
                    </ExplorerVaultsProvider>
                  </WalletProvider>
                </ToastProvider>
              </AdvisoryAgreementProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </WagmiBoundary>
    </ErrorBoundary>
  )
}
