import { TelegramConnectionCard } from '@/components/auth/telegram-connection-card';
import {
  ConsolePanel,
  FrameCornerHandles,
  SecureConsoleFrame,
} from '@/components/console/secure-console-frame';
import { LanguageToggle } from '@/components/language-toggle';
import { ThemeToggle } from '@/components/theme-toggle';
import { parseTelegramAuthEnvironment } from '@/server/auth/auth-policy';

export default function ConnectionsPage() {
  const telegramEnabled = parseTelegramAuthEnvironment(process.env) !== null;

  return (
    <SecureConsoleFrame
      variant="checkpoint"
      eyebrow="ACCOUNT / CONNECTIONS"
      title="Account connections"
      subtitle="Control which identities can access your private publishing workflow."
      statuses={[
        { label: 'IDENTITY', value: 'VERIFIED', tone: 'success' },
        { label: 'TELEGRAM', value: telegramEnabled ? 'AVAILABLE' : 'OFFLINE', tone: telegramEnabled ? 'action' : 'warning' },
        { label: 'WORKSPACE', value: 'PRIVATE', tone: 'neutral' },
        { label: 'SESSION', value: 'ACTIVE', tone: 'success' },
      ]}
      header={
        <header className="console-header">
          <a href="/workspace" className="inline-flex min-w-0 items-center gap-2 font-semibold tracking-tight">
            <span className="inline-flex size-8 shrink-0 items-center justify-center border border-foreground/80 bg-foreground text-background">
              XA
            </span>
            <span className="truncate max-[350px]:hidden">xArticle</span>
          </a>
          <div className="ml-auto flex items-center gap-1.5">
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </header>
      }
      footer={
        <>
          <span className="font-mono text-[0.6rem] uppercase tracking-[0.12em]">PRIVATE SETTINGS</span>
          <a href="/workspace" className="font-mono text-[0.6rem] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground">
            Back to workspace
          </a>
        </>
      }
      panel={false}
    >
      <ConsolePanel corners={false} className="bg-card/70 p-3 sm:p-4">
        <FrameCornerHandles className="size-2.5 bg-card" />
        <div className="mb-3 border-b border-dotted border-border/70 pb-2 font-mono text-[0.65rem] font-semibold uppercase tracking-[0.14em]">
          LINKED IDENTITIES
        </div>
        <TelegramConnectionCard
          enabled={telegramEnabled}
          className="rounded-none border-0 bg-transparent p-0 shadow-none"
        />
      </ConsolePanel>
    </SecureConsoleFrame>
  );
}
