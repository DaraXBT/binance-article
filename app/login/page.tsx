import { LoginForm } from '@/components/auth/login-form';
import { LanguageToggle } from '@/components/language-toggle';
import {
  ConsoleHeader,
  SecureConsoleFrame,
  type ConsoleStatusItem,
} from '@/components/console/secure-console-frame';
import { ThemeToggle } from '@/components/theme-toggle';
import { parseTelegramAuthEnvironment } from '@/server/auth/auth-policy';
import { normalizeLoginCallback } from '@/server/auth/page-authorization';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackURL?: string | string[]; error?: string | string[] }>;
}) {
  const params = await searchParams;
  const callbackURL = normalizeLoginCallback(params.callbackURL);
  const accountDisabled = Array.isArray(params.error)
    ? params.error.includes('account_disabled')
    : params.error === 'account_disabled';
  const hasHeldDraft = callbackURL.startsWith('/workspace?resume=');
  const statuses: ConsoleStatusItem[] = [
    { label: 'Draft', value: hasHeldDraft ? 'Held' : 'New', tone: hasHeldDraft ? 'action' : 'neutral' },
    {
      label: 'Identity',
      value: accountDisabled ? 'Suspended' : 'Required',
      tone: accountDisabled ? 'danger' : 'warning',
    },
    { label: 'Workspace', value: 'Waiting', tone: 'neutral' },
    { label: 'AI access', value: 'Gated', tone: 'warning' },
  ];

  return (
    <SecureConsoleFrame
      variant="checkpoint"
      eyebrow="Identity checkpoint"
      title="Access your workspace"
      subtitle="Sign in with a provider already linked to your xArticle account."
      header={(
        <ConsoleHeader
          actions={(
            <>
              <LanguageToggle />
              <ThemeToggle />
            </>
          )}
        />
      )}
      statuses={statuses}
      panel={false}
      contentClassName="flex items-center justify-center py-3 sm:py-5"
      footer={(
        <>
          <span className="font-mono uppercase tracking-[0.12em]">Invite-only access</span>
          <span>Returning account</span>
        </>
      )}
    >
      <div className="mx-auto w-full max-w-md">
        {accountDisabled ? (
          <div
            className="mb-3 border border-dotted border-destructive/40 bg-destructive/5 p-3"
            role="alert"
          >
            <p className="font-mono text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-destructive">
              Account status
            </p>
            <p className="mt-1 text-sm leading-relaxed text-destructive">
              This account is suspended or revoked. Contact the workspace owner.
            </p>
          </div>
        ) : null}
        <LoginForm
          callbackURL={callbackURL}
          telegramEnabled={parseTelegramAuthEnvironment(process.env) !== null}
          headingLevel={2}
        />
      </div>
    </SecureConsoleFrame>
  );
}
