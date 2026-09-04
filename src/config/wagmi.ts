import { cookieStorage, createStorage, http, fallback } from 'wagmi'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { base } from '@reown/appkit/networks'
import type { AppKitNetwork } from '@reown/appkit/networks'
import { getAppUrl } from '@/lib/app-url'
import { APP_NAME } from '@/lib/base-app'

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
  transports: {
    [base.id]: fallback([http(alchemyUrl), http()]),
  },
})

export const config = wagmiAdapter.wagmiConfig

declare module 'wagmi' {
  interface Register {
    config: typeof config
  }
}
