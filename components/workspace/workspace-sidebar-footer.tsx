'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRightLeft,
  Check,
  ChevronUp,
  Copy,
  KeyRound,
  Loader2,
  LogOut,
  RotateCcw,
  Settings2,
  UserRound,
} from 'lucide-react';

import { useLanguage } from '@/components/language-provider';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useSidebar } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import { RecoverWorkspaceDialog } from './recover-workspace-dialog';

export interface WorkspaceSidebarFooterProps {
  accessKeyPrefix: string;
  showRecovery?: boolean;
  accountLabel?: string;
  accountEmail?: string | null;
  accountInitial?: string;
  profileLabel?: string;
  settingsLabel?: string;
  settingsHref?: string;
  onOpenSettings?: () => void;
  importOldWorkspaceLabel?: string;
  onImportOldWorkspace?: () => void;
  signOutLabel?: string;
  signingOutLabel?: string;
  isSigningOut?: boolean;
  onSignOut?: () => void | Promise<void>;
  className?: string;
}

function firstAccountCharacter(accountLabel: string) {
  return Array.from(accountLabel.trim())[0]?.toLocaleUpperCase() ?? '';
}

export function WorkspaceSidebarFooter({
  accessKeyPrefix,
  showRecovery = true,
  accountLabel = 'Workspace',
  accountEmail,
  accountInitial,
  profileLabel,
  settingsLabel = 'Settings',
  settingsHref = '/workspace?settings=connections',
  onOpenSettings,
  importOldWorkspaceLabel,
  onImportOldWorkspace,
  signOutLabel,
  signingOutLabel,
  isSigningOut = false,
  onSignOut,
  className,
}: WorkspaceSidebarFooterProps) {
  const { messages } = useLanguage();
  const { isMobile, state } = useSidebar();
  const [copied, setCopied] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [recoverOpen, setRecoverOpen] = useState(false);
  const suppressProfileFocusRestoreRef = useRef(false);
  const isCollapsedDesktop = !isMobile && state === 'collapsed';
  const profilePopoverSide = isCollapsedDesktop ? 'right' : 'top';
  const profilePopoverAlign = isCollapsedDesktop ? 'end' : 'start';
  const profilePopoverSideOffset = isCollapsedDesktop ? 12 : 8;
  const profilePopoverWidth = isCollapsedDesktop
    ? 'min(calc(var(--studio-rail-width) - 1rem), calc(100vw - 1rem))'
    : 'var(--radix-popover-trigger-width)';
  const resolvedInitial = accountInitial || firstAccountCharacter(accountLabel);
  const resolvedImportLabel = importOldWorkspaceLabel
    ?? messages.dashboard?.importOldWorkspace
    ?? 'Import old workspace';
  const resolvedSignOutLabel = signOutLabel
    ?? messages.dashboard?.signOut
    ?? 'Sign out';
  const resolvedSigningOutLabel = signingOutLabel
    ?? messages.dashboard?.signingOut
    ?? 'Signing out…';

  const handleCopy = async () => {
    // Account workspaces never expose a full key; only the prefix is shown.
    const textToCopy = accessKeyPrefix;
    try {
      if (!navigator.clipboard?.writeText) return;
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const handleRecoveryOpen = () => {
    suppressProfileFocusRestoreRef.current = true;
    setProfileOpen(false);
    setRecoverOpen(true);
  };

  const handleSettingsOpen = () => {
    suppressProfileFocusRestoreRef.current = true;
    setProfileOpen(false);
    onOpenSettings?.();
  };

  const handleImportOldWorkspace = () => {
    suppressProfileFocusRestoreRef.current = true;
    setProfileOpen(false);
    onImportOldWorkspace?.();
  };

  const handleSignOut = () => {
    if (!onSignOut || isSigningOut) return;
    void onSignOut();
  };

  const copyLabel = copied
    ? messages.workspace.keyCopied
    : messages.workspace.copyPrefix;

  return (
    <>
      <Popover open={profileOpen} onOpenChange={setProfileOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            data-workspace-account-trigger
            aria-label={profileLabel ?? `Account: ${accountLabel}`}
            title={profileLabel ?? accountLabel}
            className={cn(
              'group h-auto min-h-11 w-full justify-start gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:min-h-0 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0',
              className,
            )}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground">
              {resolvedInitial || <UserRound aria-hidden="true" className="size-4" />}
            </span>
            <span className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
              <span className="block truncate text-sm font-medium text-sidebar-foreground">
                {accountLabel}
              </span>
              {accountEmail && accountEmail !== accountLabel ? (
                <span className="block truncate text-xs text-sidebar-foreground/60">
                  {accountEmail}
                </span>
              ) : null}
            </span>
            <ChevronUp
              aria-hidden="true"
              className="size-4 shrink-0 text-sidebar-foreground/55 transition-transform group-data-[state=open]:rotate-180 group-data-[collapsible=icon]:hidden"
            />
          </Button>
        </PopoverTrigger>

        <PopoverContent
          data-workspace-profile-popover="true"
          data-workspace-profile-placement={isCollapsedDesktop ? 'collapsed-rail' : 'account-row'}
          side={profilePopoverSide}
          align={profilePopoverAlign}
          sideOffset={profilePopoverSideOffset}
          style={{ width: profilePopoverWidth }}
          className="rounded-xl border-border/80 p-1.5 shadow-lg"
          onCloseAutoFocus={(event) => {
            if (!suppressProfileFocusRestoreRef.current) return;
            event.preventDefault();
            suppressProfileFocusRestoreRef.current = false;
          }}
        >
          <div className="min-w-0 px-2.5 py-2">
            <p className="truncate text-sm font-medium text-foreground">{accountLabel}</p>
            {accountEmail ? (
              <p className="truncate text-xs text-muted-foreground">{accountEmail}</p>
            ) : null}
          </div>

          <div className="border-t border-border/70 py-1">
            {onOpenSettings ? (
              <Button
                type="button"
                variant="ghost"
                className="h-9 w-full justify-start rounded-lg px-2.5 font-normal"
                onClick={handleSettingsOpen}
              >
                <Settings2 aria-hidden="true" className="size-4" />
                {settingsLabel}
              </Button>
            ) : (
              <Button
                asChild
                variant="ghost"
                className="h-9 w-full justify-start rounded-lg px-2.5 font-normal"
              >
                <Link href={settingsHref} onClick={handleSettingsOpen}>
                  <Settings2 aria-hidden="true" className="size-4" />
                  {settingsLabel}
                </Link>
              </Button>
            )}
          </div>

          <div className="border-t border-border/70 py-1.5">
            <ThemeToggle
              showLabel
              className="w-full min-w-0 overflow-hidden rounded-lg"
            />
          </div>

          <div
            data-workspace-key-controls
            className="border-t border-border/70 px-2.5 py-2"
          >
            <div className="flex min-w-0 items-center gap-2">
              <KeyRound aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-[0.68rem] font-semibold tracking-wide text-foreground">
                  {accessKeyPrefix}...
                </p>
                <p className="truncate font-mono text-[0.58rem] uppercase tracking-[0.12em] text-muted-foreground">
                  {messages.workspace.sidebarKeyLabel}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => void handleCopy()}
                className="size-8 rounded-lg"
                aria-label={copyLabel}
              >
                {copied ? (
                  <Check aria-hidden="true" className="size-3.5" />
                ) : (
                  <Copy aria-hidden="true" className="size-3.5" />
                )}
              </Button>
              {showRecovery ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={handleRecoveryOpen}
                  className="size-8 rounded-lg"
                  aria-label={messages.workspace.recoverDialogTitle}
                >
                  <RotateCcw aria-hidden="true" className="size-3.5" />
                </Button>
              ) : null}
            </div>
            <span className="sr-only" role="status" aria-live="polite">
              {copied ? messages.workspace.keyCopied : ''}
            </span>
          </div>

          {onImportOldWorkspace ? (
            <div className="border-t border-border/70 py-1">
              <Button
                type="button"
                variant="ghost"
                onClick={handleImportOldWorkspace}
                className="h-9 w-full justify-start rounded-lg px-2.5 font-normal"
              >
                <ArrowRightLeft aria-hidden="true" className="size-4" />
                {resolvedImportLabel}
              </Button>
            </div>
          ) : null}

          {onSignOut ? (
            <div className="border-t border-border/70 pt-1">
              <Button
                type="button"
                variant="ghost"
                disabled={isSigningOut}
                onClick={handleSignOut}
                className="h-9 w-full justify-start rounded-lg px-2.5 font-normal text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                {isSigningOut ? (
                  <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                ) : (
                  <LogOut aria-hidden="true" className="size-4" />
                )}
                {isSigningOut ? resolvedSigningOutLabel : resolvedSignOutLabel}
              </Button>
            </div>
          ) : null}
        </PopoverContent>
      </Popover>

      {showRecovery ? (
        <RecoverWorkspaceDialog
          open={recoverOpen}
          onOpenChange={setRecoverOpen}
        />
      ) : null}
    </>
  );
}
