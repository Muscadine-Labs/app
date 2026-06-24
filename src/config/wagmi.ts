'use client'

import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { base as baseChain } from 'wagmi/chains'
import { http, fallback } from 'wagmi'

// Validate required environment variables
const alchemyApiKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

if (!alchemyApiKey) {
  throw new Error(
    'NEXT_PUBLIC_ALCHEMY_API_KEY is required but not set. ' +
    'Please set it in your environment variables.'
  );
}

if (!walletConnectProjectId) {
  throw new Error(
    'NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is required but not set. ' +
    'Get a project ID at https://cloud.walletconnect.com/'
  );
}

const alchemyUrl = `https://base-mainnet.g.alchemy.com/v2/${alchemyApiKey}`;

export const config = getDefaultConfig({
  appName: 'Muscadine',
  projectId: walletConnectProjectId,
  chains: [baseChain], // Base is the default and only chain
  transports: {
    [baseChain.id]: fallback([
      http(alchemyUrl),
      http(), // Public RPC fallback for balance fetching
    ]),
  },
  ssr: true,
 
})

declare module 'wagmi' {
  interface Register {
    config: typeof config
  }
}

