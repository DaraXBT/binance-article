'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  Bot,
  KeyRound,
  MonitorUp,
  ShieldCheck,
  X,
} from 'lucide-react';

import { AdminPeopleAccessCard } from '@/components/admin-people-access-card';
import { PublisherDevicePairingCard } from '@/components/publisher-device-pairing-card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { WorkspaceAiCredentialCard } from '@/components/workspace-ai-credential-card';
import { cn } from '@/lib/utils';

type SettingsSectionId = 'ai' | 'publishing' | 'access';

interface SettingsSection {
  id: SettingsSectionId;
  label: string;
}

const BASE_SECTIONS: readonly SettingsSection[] = [
  {
    id: 'ai',
    label: 'AI & generation',
  },
  {
    id: 'publishing',
    label: 'Publishing',
  },
] as const;

const ACCESS_SECTION: SettingsSection = {
  id: 'access',
  label: 'People & access',
};

export interface ConnectionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManageAi: boolean;
  canManageAccess: boolean;
}

function SettingsPanel({
  labelledBy,
  active,
  children,
}: {
  labelledBy: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={labelledBy}
      className={cn(
        'w-full max-w-none rounded-none border-0 bg-transparent p-0 shadow-none',
        !active && 'hidden',
      )}
    >
      {children}
    </section>
  );
}

export function ConnectionsDialog({
  open,
  onOpenChange,
  canManageAi,
  canManageAccess,
}: ConnectionsDialogProps) {
  const sections = useMemo(
    () => canManageAccess ? [...BASE_SECTIONS, ACCESS_SECTION] : [...BASE_SECTIONS],
    [canManageAccess],
  );
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('ai');
  const [visitedSections, setVisitedSections] = useState<Set<SettingsSectionId>>(
    () => new Set(['ai']),
  );
  const [hasUncopiedEnrollmentAccess, setHasUncopiedEnrollmentAccess] = useState(false);
  const [hasUncopiedPairing, setHasUncopiedPairing] = useState(false);
  const [closeWarningOpen, setCloseWarningOpen] = useState(false);
  const [settingsSessionEpoch, setSettingsSessionEpoch] = useState(0);
  const settingsSessionEpochRef = useRef(0);
  const previousOpenRef = useRef(open);
  const hasSensitiveValue = hasUncopiedEnrollmentAccess || hasUncopiedPairing;
  const sensitiveSection: SettingsSectionId = hasUncopiedPairing ? 'publishing' : 'access';
  // If URL state closes underneath an uncopied value (for example Browser
  // Back), retain the mounted shell so the one-time value is not destroyed.
  const effectiveOpen = open || hasSensitiveValue;

  const invalidateSettingsSession = useCallback(() => {
    const nextEpoch = settingsSessionEpochRef.current + 1;
    settingsSessionEpochRef.current = nextEpoch;
    setSettingsSessionEpoch(nextEpoch);
  }, []);

  const handleUncopiedEnrollmentAccessChange = useCallback((hasUncopiedAccess: boolean) => {
    if (settingsSessionEpochRef.current !== settingsSessionEpoch) return;
    setHasUncopiedEnrollmentAccess(hasUncopiedAccess);
  }, [settingsSessionEpoch]);

  const handleUncopiedPairingChange = useCallback((nextHasUncopiedPairing: boolean) => {
    if (settingsSessionEpochRef.current !== settingsSessionEpoch) return;
    setHasUncopiedPairing(nextHasUncopiedPairing);
  }, [settingsSessionEpoch]);

  useLayoutEffect(() => {
    const wasOpen = previousOpenRef.current;
    previousOpenRef.current = open;
    if (wasOpen && !open && !hasSensitiveValue) invalidateSettingsSession();
  }, [hasSensitiveValue, invalidateSettingsSession, open]);

  useEffect(() => {
    if (!open && hasSensitiveValue) setCloseWarningOpen(true);
  }, [hasSensitiveValue, open]);

  useEffect(() => {
    if (hasSensitiveValue) return;
    setCloseWarningOpen(false);
    if (!open) {
      setActiveSection('ai');
      setVisitedSections(new Set(['ai']));
    }
  }, [hasSensitiveValue, open]);

  useEffect(() => {
    if (!canManageAccess && activeSection === 'access') {
      setActiveSection('ai');
    }
  }, [activeSection, canManageAccess]);

  useEffect(() => {
    if (!hasSensitiveValue) return;
    const protectOneTimeValue = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', protectOneTimeValue);
    return () => window.removeEventListener('beforeunload', protectOneTimeValue);
  }, [hasSensitiveValue]);

  const selectSection = (next: string) => {
    const section = sections.find((candidate) => candidate.id === next);
    if (!section) return;
    setActiveSection(section.id);
    setVisitedSections((current) => {
      if (current.has(section.id)) return current;
      return new Set([...current, section.id]);
    });
    setCloseWarningOpen(false);
  };

  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentSection: SettingsSectionId,
  ) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const currentIndex = sections.findIndex((section) => section.id === currentSection);
    const lastIndex = sections.length - 1;
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? lastIndex
        : event.key === 'ArrowRight' || event.key === 'ArrowDown'
          ? (currentIndex + 1) % sections.length
          : (currentIndex - 1 + sections.length) % sections.length;
    const nextSection = sections[nextIndex];
    if (!nextSection) return;
    selectSection(nextSection.id);
    const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]');
    tabs?.[nextIndex]?.focus();
  };

  const requestClose = () => {
    if (hasSensitiveValue) {
      setCloseWarningOpen(true);
      return;
    }
    invalidateSettingsSession();
    onOpenChange(false);
  };

  const reviewSensitiveValue = () => {
    selectSection(sensitiveSection);
    if (!open) onOpenChange(true);
  };

  const discardAndClose = () => {
    invalidateSettingsSession();
    setHasUncopiedEnrollmentAccess(false);
    setHasUncopiedPairing(false);
    setCloseWarningOpen(false);
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
        className="!h-[min(44rem,calc(100dvh-2rem))] !w-[calc(100%-2rem)] !max-w-5xl grid-cols-1 grid-rows-[minmax(0,1fr)] gap-0 overflow-hidden rounded-xl border-border/80 bg-card p-0 shadow-lg"
      >
        <Tabs
          value={activeSection}
          onValueChange={selectSection}
          className="grid h-full min-h-0 grid-cols-1 grid-rows-[auto_auto_minmax(0,1fr)] gap-0 md:grid-cols-[14rem_minmax(0,1fr)] md:grid-rows-[auto_minmax(0,1fr)]"
        >
          <aside
            data-connections-settings-rail
            aria-label="Settings navigation"
            className="sticky top-0 z-20 row-start-2 min-w-0 border-b border-border/70 bg-card/95 px-2 py-2 backdrop-blur md:col-start-1 md:row-span-2 md:row-start-1 md:flex md:min-h-0 md:flex-col md:border-b-0 md:border-r md:bg-muted/30 md:p-3"
          >
            <div className="hidden px-2 pb-5 pt-2 md:block">
              <div className="flex size-9 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
                <Bot aria-hidden="true" className="size-4" />
              </div>
              <p className="mt-4 font-mono text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-primary">
                Account settings
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Personal connections and access
              </p>
            </div>

            <TabsList
              aria-label="Settings sections"
              className="h-auto min-h-11 w-full justify-start gap-1 overflow-x-auto bg-transparent p-0 md:flex-none md:flex-col md:items-stretch md:justify-start md:overflow-visible"
            >
              {sections.map((section) => {
                const Icon = section.id === 'ai'
                  ? KeyRound
                  : section.id === 'publishing'
                    ? MonitorUp
                    : ShieldCheck;
                return (
                  <TabsTrigger
                    key={section.id}
                    value={section.id}
                    onClick={() => selectSection(section.id)}
                    onFocus={() => selectSection(section.id)}
                    onKeyDown={(event) => handleTabKeyDown(event, section.id)}
                    className="min-h-11 min-w-11 flex-none justify-start rounded-lg px-3 text-xs data-[state=active]:border-primary/25 data-[state=active]:bg-primary/10 data-[state=active]:text-foreground data-[state=active]:shadow-none md:h-11 md:w-full md:flex-none md:text-sm"
                  >
                    <Icon aria-hidden="true" className="size-4 shrink-0 text-primary" />
                    <span>{section.label}</span>
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </aside>

          <DialogHeader className="relative row-start-1 min-w-0 gap-1.5 border-b border-border/70 px-4 py-4 pr-14 text-left sm:px-6 sm:py-5 sm:pr-16 md:col-start-2 md:row-start-1">
            <p className="font-mono text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-primary md:hidden">
              Account
            </p>
            <DialogTitle className="text-2xl leading-tight tracking-normal sm:text-3xl">
              Account settings
            </DialogTitle>
            <DialogDescription className="max-w-2xl text-xs leading-relaxed sm:text-sm">
              Manage AI generation, publishing computers, and account access in one place.
            </DialogDescription>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-2 top-2 z-30 size-11 rounded-lg sm:right-3 sm:top-3"
              aria-label="Close account settings"
              onClick={requestClose}
            >
              <X aria-hidden="true" className="size-4" />
            </Button>
          </DialogHeader>

          <div
            data-connections-settings-content
            className="row-start-3 grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] md:col-start-2 md:row-start-2"
          >
            {closeWarningOpen ? (
              <div
                role="alert"
                className="m-3 flex flex-col gap-3 rounded-none border border-amber-500/40 bg-amber-500/10 p-3 text-sm sm:mx-5 sm:mt-5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium text-foreground">Copy your one-time value before closing.</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    It will not be shown again after Account settings closes.
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={reviewSensitiveValue}>
                    Review code
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={discardAndClose}>
                    Discard and close
                  </Button>
                </div>
              </div>
            ) : null}

            <div
              data-connections-dialog-scroll
              className="min-h-0 overflow-y-auto overscroll-contain p-3 sm:p-5 lg:p-6"
            >
              {visitedSections.has('ai') ? (
                <TabsContent value="ai" forceMount className="m-0 data-[state=inactive]:hidden">
                  <SettingsPanel labelledBy="settings-ai-title" active={activeSection === 'ai'}>
                    <div className="mb-4 border-b border-dotted border-border/70 pb-3">
                      <h2 id="settings-ai-title" className="text-base font-semibold">AI &amp; generation</h2>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        Choose how article generation connects to Gemini.
                      </p>
                    </div>
                    <WorkspaceAiCredentialCard
                      canManageAi={canManageAi}
                      className="max-w-none rounded-none border-0 bg-transparent p-0 shadow-none"
                    />
                  </SettingsPanel>
                </TabsContent>
              ) : null}

              {visitedSections.has('publishing') ? (
                <TabsContent value="publishing" forceMount className="m-0 data-[state=inactive]:hidden">
                  <SettingsPanel labelledBy="settings-publishing-title" active={activeSection === 'publishing'}>
                    <div className="mb-4 border-b border-dotted border-border/70 pb-3">
                      <h2 id="settings-publishing-title" className="text-base font-semibold">Publishing</h2>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        Pair and manage the computers that publish through your signed-in browser sessions.
                      </p>
                    </div>
                    <PublisherDevicePairingCard
                      className="max-w-none rounded-none border-0 bg-transparent p-0 shadow-none"
                      onUncopiedPairingChange={handleUncopiedPairingChange}
                    />
                  </SettingsPanel>
                </TabsContent>
              ) : null}

              {canManageAccess && visitedSections.has('access') ? (
                <TabsContent value="access" forceMount className="m-0 data-[state=inactive]:hidden">
                  <SettingsPanel labelledBy="settings-access-title" active={activeSection === 'access'}>
                    <h2 id="settings-access-title" className="sr-only">People &amp; access</h2>
                    <AdminPeopleAccessCard
                      className="rounded-none border-0 bg-transparent p-0 shadow-none"
                      showFrameCorners={false}
                      onUncopiedAccessChange={handleUncopiedEnrollmentAccessChange}
                    />
                  </SettingsPanel>
                </TabsContent>
              ) : null}
            </div>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
