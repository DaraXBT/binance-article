import { JoinForm } from '@/components/auth/join-form';
import {
  ConsoleHeader,
  SecureConsoleFrame,
} from '@/components/console/secure-console-frame';
import { ThemeToggle } from '@/components/theme-toggle';

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const params = await searchParams;
  const token = typeof params.token === 'string' ? params.token : null;

  return (
    <SecureConsoleFrame
      variant="checkpoint"
      header={(
        <ConsoleHeader
          actions={(
            <>
              <ThemeToggle />
            </>
          )}
        />
      )}
      panel={false}
      contentClassName="flex items-center justify-center py-3 sm:py-5"
      footer={(
        <>
          <span className="font-mono uppercase tracking-[0.12em]">Invitation required</span>
          <span>Account enrollment</span>
        </>
      )}
    >
      <div className="mx-auto w-full max-w-md">
        <JoinForm
          token={token}
        />
      </div>
    </SecureConsoleFrame>
  );
}
