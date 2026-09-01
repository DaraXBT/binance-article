import type { Metadata } from 'next'
import localFont from 'next/font/local'
import { cookies } from 'next/headers'
import '@fontsource/google-sans/latin.css'

import { Providers } from '@/components/providers'
import { isLanguage, LANGUAGE_COOKIE_NAME, UI_LANGUAGE } from '@/lib/i18n'
import { metadataForLanguage } from '@/lib/page-metadata'
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

const baseMetadata: Omit<Metadata, 'title' | 'description'> = {
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

async function savedLanguage() {
  const cookieStore = await cookies()
  const saved = cookieStore.get(LANGUAGE_COOKIE_NAME)?.value
  return isLanguage(saved) ? saved : UI_LANGUAGE
}

export async function generateMetadata(): Promise<Metadata> {
  return {
    ...baseMetadata,
    ...metadataForLanguage(await savedLanguage()),
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const initialLanguage = await savedLanguage()

  return (
    <html lang={initialLanguage} suppressHydrationWarning>
      <body
        className={`${interKhmerLooped.variable} bg-background font-sans text-foreground antialiased`}
      >
        <Providers initialLanguage={initialLanguage}>
          {children}
        </Providers>
      </body>
    </html>
  )
}
