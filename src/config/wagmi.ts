import { cookieStorage, createStorage, http, fallback } from 'wagmi'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { lazyBaseAccount, lazyCoinbaseWallet } from '@/lib/lazy-connectors'
import { base } from '@reown/appkit/networks'
import type { AppKitNetwork } from '@reown/appkit/networks'
import { getAppUrl } from '@/lib/app-url'
import { APP_NAME } from '@/lib/constants'

const alchemyApiKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY
const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID

if (!alchemyApiKey) {
  throw new Error(
    'NEXT_PUBLIC_ALCHEMY_API_KEY is required but not set. ' +
      'Please set it in your environment variables.'
  )
}

if (!walletConnectProjectId) {
  throw new Error(
    'NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is required but not set. ' +
      'Get a project ID at https://dashboard.reown.com/'
  )
}

const appUrl = getAppUrl()
const alchemyUrl = `https://base-mainnet.g.alchemy.com/v2/${alchemyApiKey}`

export const projectId = walletConnectProjectId

export const networks: [AppKitNetwork, ...AppKitNetwork[]] = [base]

export const metadata = {
  name: APP_NAME,
  description: 'Muscadine Vaults',
  url: appUrl,
  icons: [`${appUrl}/favicon.png`],
}

export const wagmiAdapter = new WagmiAdapter({
  storage: createStorage({
    storage: cookieStorage,
  }),
  ssr: true,
  projectId,
  networks,
  // Registered here so AppKit skips its default Base Account and Coinbase connectors.
  // AppKit's Base Account SDK sends telemetry to Coinbase unless told not to. Both are
  // lazy: they stay out of the mount-time reconnect until someone uses them
  // (lazy-connectors.ts), so neither SDK loads on every page.
  connectors: [
    lazyBaseAccount({
      appName: APP_NAME,
      appLogoUrl: `${appUrl}/favicon.png`,
      preference: { telemetry: false },
    }),
    lazyCoinbaseWallet({
      appName: APP_NAME,
      appLogoUrl: `${appUrl}/favicon.png`,
    }),
  ],
  transports: {
    // JSON-RPC batching: parallel reads made in the same tick (force-withdraw planner, deposit
    // caps, position reads) go out as one HTTP request to Alchemy instead of one each.
    [base.id]: fallback([http(alchemyUrl, { batch: true }), http()]),
  },
})

export const config = wagmiAdapter.wagmiConfig

declare module 'wagmi' {
  interface Register {
    config: typeof config
  }
}
