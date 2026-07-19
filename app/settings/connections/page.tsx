import { TelegramConnectionCard } from '@/components/auth/telegram-connection-card';

export default function ConnectionsPage() {
  return (
    <main className="flex min-h-screen justify-center bg-muted/30 px-4 py-12">
      <div className="w-full max-w-xl space-y-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Account connections</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Control which identities can access your private publishing workflow.
          </p>
        </div>
        <TelegramConnectionCard />
      </div>
    </main>
  );
}
