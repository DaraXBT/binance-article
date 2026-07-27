'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';

import { AdminInvitationsCard } from '@/components/admin-invitations-card';
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
  const [hasUncopiedInvitation, setHasUncopiedInvitation] = useState(false);
  const [hasUncopiedPairing, setHasUncopiedPairing] = useState(false);
  const [closeConfirmationOpen, setCloseConfirmationOpen] = useState(false);
  const hasSensitiveValue = hasUncopiedInvitation || hasUncopiedPairing;
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
        className="h-[calc(100dvh-0.5rem)] max-h-[calc(100dvh-0.5rem)] w-[calc(100%-0.5rem)] max-w-none grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-lg border-dotted bg-card p-0 shadow-xl sm:h-[min(48rem,calc(100dvh-3rem))] sm:max-h-[calc(100dvh-3rem)] sm:w-[calc(100%-3rem)] sm:max-w-5xl sm:rounded-xl"
      >
        <DialogHeader className="relative shrink-0 gap-1.5 border-b border-dotted border-border/70 px-4 py-4 pr-14 text-left sm:px-6 sm:py-5 sm:pr-16">
          <p className="font-mono text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-primary">
            Workspace / Settings
          </p>
          <DialogTitle className="text-2xl leading-tight tracking-normal sm:text-3xl">
            Connections
          </DialogTitle>
          <DialogDescription className="max-w-2xl text-xs leading-relaxed sm:text-sm">
            Manage the AI provider and browser publisher connections used by this workspace.
          </DialogDescription>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-2 top-2 size-10 rounded-lg sm:right-4 sm:top-4"
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
            <AdminInvitationsCard
              onUncopiedInvitationChange={setHasUncopiedInvitation}
            />
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
              A one-time invitation link or pairing code is still being created or has not been copied. If you close now, you may need to revoke it and create another one.
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
                setHasUncopiedInvitation(false);
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
