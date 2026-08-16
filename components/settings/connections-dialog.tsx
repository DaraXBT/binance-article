'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { PlugZap, X } from 'lucide-react';

import { AdminPeopleAccessCard } from '@/components/admin-people-access-card';
import {
  ConsolePanel,
  FrameCornerHandles,
} from '@/components/console/secure-console-frame';
import { PublisherDevicePairingCard } from '@/components/publisher-device-pairing-card';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { WorkspaceAiCredentialCard } from '@/components/workspace-ai-credential-card';

type WorkspaceRole = 'owner' | 'member' | null | undefined;

export interface ConnectionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceRole: WorkspaceRole;
}

function ConnectionSection({
  title,
  titleId,
  children,
}: {
  title: string;
  titleId: string;
  children: ReactNode;
}) {
  return (
    <ConsolePanel
      as="section"
      corners={false}
      className="rounded-xl bg-card/70 p-3 sm:p-5"
    >
      <FrameCornerHandles />
      <h3
        id={titleId}
        className="mb-3 border-b border-dotted border-border/70 pb-2 font-mono text-[0.65rem] font-semibold uppercase tracking-[0.14em]"
      >
        {title}
      </h3>
      {children}
    </ConsolePanel>
  );
}

export function ConnectionsDialog({
  open,
  onOpenChange,
  workspaceRole,
}: ConnectionsDialogProps) {
  const [hasUncopiedEnrollmentAccess, setHasUncopiedEnrollmentAccess] = useState(false);
  const [hasUncopiedPairing, setHasUncopiedPairing] = useState(false);
  const [closeConfirmationOpen, setCloseConfirmationOpen] = useState(false);
  const hasSensitiveValue = hasUncopiedEnrollmentAccess || hasUncopiedPairing;
  // If URL state closes underneath an uncopied value (for example Browser
  // Back), retain the mounted dialog long enough to ask for confirmation.
  const effectiveOpen = open || hasSensitiveValue;

  useEffect(() => {
    if (!open && hasSensitiveValue) setCloseConfirmationOpen(true);
  }, [hasSensitiveValue, open]);

  useEffect(() => {
    if (!hasSensitiveValue) return;
    const protectOneTimeValue = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', protectOneTimeValue);
    return () => window.removeEventListener('beforeunload', protectOneTimeValue);
  }, [hasSensitiveValue]);

  const requestClose = () => {
    if (hasSensitiveValue) {
      setCloseConfirmationOpen(true);
      return;
    }
    onOpenChange(false);
  };

  return (
    <Dialog
      open={effectiveOpen}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) requestClose();
      }}
    >
      <DialogContent
        data-connections-dialog
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          const accountTrigger = document.querySelector<HTMLElement>(
            '[data-workspace-account-trigger]',
          );
          if (!accountTrigger) return;
          event.preventDefault();
          accountTrigger.focus();
        }}
        className="relative h-[calc(100dvh-0.5rem)] max-h-[calc(100dvh-0.5rem)] w-[calc(100%-0.5rem)] max-w-none grid-cols-1 grid-rows-[minmax(0,1fr)] gap-0 overflow-hidden rounded-lg border-dotted bg-card p-0 shadow-xl sm:h-[min(48rem,calc(100dvh-3rem))] sm:max-h-[calc(100dvh-3rem)] sm:w-[calc(100%-3rem)] sm:max-w-6xl sm:rounded-xl md:grid-cols-[13.5rem_minmax(0,1fr)]"
      >
        <aside
          data-connections-settings-rail
          aria-label="Settings navigation"
          className="hidden min-h-0 flex-col gap-4 overflow-hidden border-r border-dotted border-border/70 bg-muted/30 p-3 md:flex"
        >
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0"
            aria-label="Close connections"
            onClick={requestClose}
          >
            <X aria-hidden="true" className="size-4" />
          </Button>

          <div className="hidden min-h-0 flex-1 flex-col gap-5 md:flex">
            <div className="px-1 pt-1">
              <p className="font-mono text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-primary">
                Settings
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Account controls
              </p>
            </div>

            <nav aria-label="Settings sections" className="px-1">
              <div
                data-connections-settings-nav-item
                aria-current="page"
                className="flex min-h-10 items-center gap-2.5 rounded-lg border border-primary/25 bg-primary/10 px-3 text-sm font-medium text-foreground"
              >
                <PlugZap aria-hidden="true" className="size-4 shrink-0 text-primary" />
                <span>Connections</span>
                <span aria-hidden="true" className="ml-auto size-1.5 rounded-full bg-primary" />
              </div>
            </nav>
          </div>
        </aside>

        <div
          data-connections-settings-content
          id="connections-settings-content"
          className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)]"
        >
          <DialogHeader className="relative shrink-0 gap-1.5 border-b border-dotted border-border/70 px-4 py-4 pr-14 text-left sm:px-6 sm:py-5 sm:pr-16">
            <div className="flex items-center gap-2 md:hidden">
              <p className="font-mono text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-primary">
                Account settings
              </p>
              <span aria-hidden="true" className="text-xs text-muted-foreground">/</span>
              <span className="text-xs font-medium text-muted-foreground">Connections</span>
            </div>
            <p className="hidden font-mono text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-primary md:block">
              Account / Settings
            </p>
            <DialogTitle className="text-2xl leading-tight tracking-normal sm:text-3xl">
              Connections
            </DialogTitle>
            <DialogDescription className="max-w-2xl text-xs leading-relaxed sm:text-sm">
              Manage the AI provider and browser publisher connections used by your account.
            </DialogDescription>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-2 top-2 size-10 rounded-lg md:hidden"
              aria-label="Close connections"
              onClick={requestClose}
            >
              <X aria-hidden="true" className="size-4" />
            </Button>
          </DialogHeader>

          <div
            data-connections-dialog-scroll
            className="min-h-0 overflow-y-auto overscroll-contain p-3 sm:p-5 lg:p-6"
          >
            <div className="mx-auto grid w-full max-w-4xl gap-4 sm:gap-5">
              <ConnectionSection title="Gemini AI" titleId="connections-gemini-title">
                <WorkspaceAiCredentialCard
                  workspaceRole={workspaceRole}
                  className="max-w-none rounded-none border-0 bg-transparent p-0 shadow-none"
                />
              </ConnectionSection>

              <ConnectionSection title="Publisher device" titleId="connections-publisher-title">
                <PublisherDevicePairingCard
                  className="max-w-none rounded-none border-0 bg-transparent p-0 shadow-none"
                  onUncopiedPairingChange={setHasUncopiedPairing}
                />
              </ConnectionSection>

              {/* This owner-only card removes itself when its API probe is rejected. */}
              <AdminPeopleAccessCard
                onUncopiedAccessChange={setHasUncopiedEnrollmentAccess}
              />
            </div>
          </div>
        </div>
      </DialogContent>

      <AlertDialog open={closeConfirmationOpen} onOpenChange={setCloseConfirmationOpen}>
        <AlertDialogContent
          className="console-dialog border-dotted p-4 sm:max-w-md sm:p-5"
          onEscapeKeyDown={(event) => event.preventDefault()}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Close before copying?</AlertDialogTitle>
            <AlertDialogDescription>
              A one-time enrollment code, join link, or pairing code is still being created or has not been copied. If you close now, you may need to rotate or create it again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setCloseConfirmationOpen(false);
                if (!open) onOpenChange(true);
              }}
            >
              Keep connections open
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setHasUncopiedEnrollmentAccess(false);
                setHasUncopiedPairing(false);
                setCloseConfirmationOpen(false);
                onOpenChange(false);
              }}
            >
              Close anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
