import type { Metadata } from 'next'
import localFont from 'next/font/local'
import '@fontsource/google-sans/latin.css'

import { Providers } from '@/components/providers'
import { UI_LANGUAGE } from '@/lib/i18n'
import './globals.css'

const interKhmerLooped = localFont({
  src: [
    {
      path: '../public/font/InterKhmerLooped-Medium.ttf',
      weight: '500',
      style: 'normal',
    },
    {
      path: '../public/font/InterKhmerLooped-Bold.ttf',
      weight: '700',
      style: 'normal',
    },
  ],
  variable: '--font-khmer',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'xArticle — Binance Square article studio',
  description: 'Turn a market idea into a publish-ready Binance Square article.',
  applicationName: 'xArticle',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang={UI_LANGUAGE} suppressHydrationWarning>
      <body
        className={`${interKhmerLooped.variable} bg-background font-sans text-foreground antialiased`}
      >
        <Providers initialLanguage={UI_LANGUAGE}>
          {children}
        </Providers>
      </body>
    </html>
  )
}
