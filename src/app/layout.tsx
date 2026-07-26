import type { Metadata } from 'next'
import { Figtree, Funnel_Display, Outfit, Tinos } from 'next/font/google'
import './globals.css'
import { AppLayout } from '@/components/layout/AppLayout'
import { headers } from 'next/headers'
import { cookieToInitialState } from 'wagmi'
import { Providers } from './Providers'
import { config } from '@/config/wagmi'
import { PriceProvider } from '@/contexts/PriceContext'
import { Analytics } from '@vercel/analytics/react'
import { getAppUrl } from '@/lib/app-url'
import { BASE_APP_ID } from '@/lib/base-app'

const appUrl = getAppUrl()

const figtree = Figtree({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800', '900'],
  style: ['normal', 'italic'],
  variable: '--font-figtree',
})

const funnelDisplay = Funnel_Display({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
  variable: '--font-funnel-display',
})

const outfit = Outfit({
  subsets: ['latin'],
  weight: ['100', '200', '300', '400', '500', '600', '700', '800', '900'],
  variable: '--font-outfit',
})

const tinos = Tinos({
  subsets: ['latin'],
  weight: ['400', '700'],
  style: ['normal', 'italic'],
  variable: '--font-tinos',
})

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: 'Muscadine Vaults',
  description: 'Deposit into curated Morpho vaults on Base. Track portfolio, APY, and allocations.',
  applicationName: 'Muscadine Vaults',
  icons: {
    icon: '/favicon.png',
    shortcut: '/favicon.png',
    apple: '/favicon.png',
  },
  alternates: {
    canonical: appUrl,
  },
  openGraph: {
    type: 'website',
    url: appUrl,
    siteName: 'Muscadine Vaults',
    title: 'Muscadine Vaults',
    description: 'Curated Morpho vaults on Base — deposit, withdraw, and track your portfolio.',
    images: [{ url: '/favicon.png', width: 512, height: 512, alt: 'Muscadine Vaults' }],
  },
  twitter: {
    card: 'summary',
    title: 'Muscadine Vaults',
    description: 'Curated Morpho vaults on Base.',
    images: ['/favicon.png'],
  },
  other: {
    'base:app_id': BASE_APP_ID,
  },
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const cookie = (await headers()).get('cookie')
  const initialState = cookieToInitialState(config, cookie)

  return (
    <html lang="en">
      <body className={`${figtree.className} ${funnelDisplay.variable} ${outfit.variable} ${tinos.variable}`}>
          <Providers initialState={initialState}>
              <PriceProvider>
                <AppLayout>{children}</AppLayout>
              </PriceProvider>
          </Providers>
          <Analytics />
      </body>
    </html>
  )
}
