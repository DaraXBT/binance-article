'use client';

import {
  ConsoleHeader,
  ConsolePanel,
  FrameCornerHandles,
  SecureConsoleFrame,
} from '@/components/console/secure-console-frame';
import { PublisherDevicePairingCard } from '@/components/publisher-device-pairing-card';
import { WorkspaceAiCredentialCard } from '@/components/workspace-ai-credential-card';
import { ThemeToggle } from '@/components/theme-toggle';
import { useWorkspace } from '@/lib/hooks';

function ConnectionsContent() {
  const { data: workspace } = useWorkspace();

  return (
    <>
      <ConsolePanel corners={false} className="rounded-xl bg-card/70 p-3 sm:p-5">
        <FrameCornerHandles />
        <div className="mb-3 border-b border-dotted border-border/70 pb-2 font-mono text-[0.65rem] font-semibold uppercase tracking-[0.14em]">
          GEMINI AI
        </div>
        <WorkspaceAiCredentialCard
          workspaceRole={workspace?.workspaceRole}
          className="max-w-none rounded-none border-0 bg-transparent p-0 shadow-none"
        />
      </ConsolePanel>

      <ConsolePanel corners={false} className="rounded-xl bg-card/70 p-3 sm:p-5">
        <FrameCornerHandles />
        <div className="mb-3 border-b border-dotted border-border/70 pb-2 font-mono text-[0.65rem] font-semibold uppercase tracking-[0.14em]">
          PUBLISHER DEVICE
        </div>
        <PublisherDevicePairingCard className="max-w-none rounded-none border-0 bg-transparent p-0 shadow-none" />
      </ConsolePanel>
    </>
  );
}

export default function ConnectionsPage() {
  return (
    <SecureConsoleFrame
      variant="checkpoint"
      surface="settings"
      eyebrow="WORKSPACE / CONNECTIONS"
      title="Connections"
      subtitle="Manage the AI provider and Browser publisher connections used by this workspace."
      header={(
        <ConsoleHeader
          brandHref="/workspace"
          contextLabel="Connections"
          actions={(
            <>
              <ThemeToggle />
            </>
          )}
        />
      )}
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
      <ConnectionsContent />
    </SecureConsoleFrame>
  );
}
