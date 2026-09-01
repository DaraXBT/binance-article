'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

import { useLanguage } from '@/components/language-provider';
import { Logo } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { Particles } from '@/components/ui/particles';

export function AuthPage({
  children,
  decorativeBackground = true,
}: {
  children: ReactNode;
  /** Keep focused flows quiet; the account form should be the only focal point. */
  decorativeBackground?: boolean;
}) {
  const { messages } = useLanguage();

  return (
    <main
      data-auth-page="true"
      className="relative min-h-dvh w-full overflow-x-hidden bg-background text-foreground"
    >
      {decorativeBackground ? (
        <Particles
          data-auth-particles="true"
          className="absolute inset-0"
          color="#666666"
          ease={20}
          quantity={120}
        />
      ) : null}

      <header className="absolute inset-x-0 top-0 z-10 flex h-16 items-center justify-between gap-3 px-4 sm:px-6">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="h-9 rounded-lg px-2"
        >
          <Link href="/" aria-label={messages.common.back}>
            <ChevronLeft aria-hidden="true" className="size-4" />
            <span className="hidden min-[390px]:inline">{messages.common.back}</span>
          </Link>
        </Button>

        <div className="flex items-center gap-2">
          <ThemeToggle />
        </div>
      </header>

      <div className="relative mx-auto flex min-h-dvh w-full max-w-5xl flex-col justify-center px-5 py-20 sm:px-8">
        <section className="mx-auto w-full max-w-sm" aria-label={messages.auth.accountAccessLabel}>
          <Logo className="mb-7" />
          {children}
        </section>
      </div>
    </main>
  );
}
