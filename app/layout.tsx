import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { Geist, Geist_Mono } from 'next/font/google'
import localFont from 'next/font/local'

import { Providers } from '@/components/providers'
import { isLanguage } from '@/lib/i18n'
import './globals.css'

const geist = Geist({
  subsets: ['latin'],
  variable: '--font-geist',
})

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
})

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
  const cookieStore = await cookies()
  const cookieLanguage = cookieStore.get('deckforge_language')?.value
  const initialLanguage = isLanguage(cookieLanguage) ? cookieLanguage : 'km'

  return (
    <html lang={initialLanguage} suppressHydrationWarning>
      <body
        className={`${geist.variable} ${geistMono.variable} ${interKhmerLooped.variable} bg-background font-sans text-foreground antialiased`}
      >
        <Providers initialLanguage={initialLanguage}>
          {children}
        </Providers>
      </body>
    </html>
  )
}
