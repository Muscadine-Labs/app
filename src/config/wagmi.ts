'use client'

import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { base as baseChain } from 'wagmi/chains'
import { http, fallback } from 'wagmi'
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
      'Get a project ID at https://cloud.walletconnect.com/'
  )
}

const appUrl = getAppUrl()
const alchemyUrl = `https://base-mainnet.g.alchemy.com/v2/${alchemyApiKey}`

export const config = getDefaultConfig({
  appName: APP_NAME,
  appDescription: 'Morpho vaults',
  appUrl,
  appIcon: `${appUrl}/favicon.png`,
  projectId: walletConnectProjectId,
  walletConnectParameters: {
    metadata: {
      name: APP_NAME,
      description: 'Morpho vaults',
      url: appUrl,
      icons: [`${appUrl}/favicon.png`],
    },
  },
  chains: [baseChain],
  transports: {
    [baseChain.id]: fallback([http(alchemyUrl), http()]),
  },
  ssr: true,
})

declare module 'wagmi' {
  interface Register {
    config: typeof config
  }
}
