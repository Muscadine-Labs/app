'use client'

import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import {
  baseAccount,
  base as coinbaseWallet,
  metaMaskWallet,
  phantomWallet,
  rabbyWallet,
  walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets'
import { base as baseChain } from 'wagmi/chains'
import { http, fallback } from 'wagmi'
import { getAppUrl } from '@/lib/app-url'

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
  appName: 'Muscadine',
  appDescription: 'Curated Morpho vaults on Base',
  appUrl,
  appIcon: `${appUrl}/favicon.png`,
  projectId: walletConnectProjectId,
  chains: [baseChain],
  wallets: [
    {
      groupName: 'Recommended',
      wallets: [
        baseAccount,
        rabbyWallet,
        metaMaskWallet,
        coinbaseWallet,
        phantomWallet,
        walletConnectWallet,
      ],
    },
  ],
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
