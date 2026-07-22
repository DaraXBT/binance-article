import {
  ConsoleHeader,
  ConsolePanel,
  FrameCornerHandles,
  SecureConsoleFrame,
} from '@/components/console/secure-console-frame';
import { PublisherDevicePairingCard } from '@/components/publisher-device-pairing-card';
import { ThemeToggle } from '@/components/theme-toggle';

export default function ConnectionsPage() {
  return (
    <SecureConsoleFrame
      variant="checkpoint"
      surface="settings"
      eyebrow="PUBLISHING / CONNECTIONS"
      title="Browser publisher"
      subtitle="Connect this web workspace to the publishing companion beside your signed-in Chrome session."
      header={(
        <ConsoleHeader
          brandHref="/workspace"
          contextLabel="Publisher"
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
      <ConsolePanel corners={false} className="rounded-xl bg-card/70 p-3 sm:p-5">
        <FrameCornerHandles />
        <div className="mb-3 border-b border-dotted border-border/70 pb-2 font-mono text-[0.65rem] font-semibold uppercase tracking-[0.14em]">
          PUBLISHER DEVICE
        </div>
        <PublisherDevicePairingCard className="max-w-none rounded-none border-0 bg-transparent p-0 shadow-none" />
      </ConsolePanel>
    </SecureConsoleFrame>
  );
}
