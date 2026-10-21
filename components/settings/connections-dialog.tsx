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
  MonitorUp,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
  Users,
  X,
} from 'lucide-react';

import { AdminPeopleAccessCard } from '@/components/admin-people-access-card';
import { useLanguage } from '@/components/language-provider';
import { PublisherDevicePairingCard } from '@/components/publisher-device-pairing-card';
import { GeneralSettingsSection } from '@/components/settings/general-settings-section';
import {
  revealOneTimeValue,
  SettingsSectionHeader,
} from '@/components/settings/settings-primitives';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { WorkspaceAiCredentialCard } from '@/components/workspace-ai-credential-card';
import { getAccountSettingsCopy } from '@/lib/account-settings-i18n';
import type { SettingsSectionId } from '@/lib/settings-sections';
import { cn } from '@/lib/utils';

export type { SettingsSectionId };

const DEFAULT_SECTION: SettingsSectionId = 'general';

interface SettingsSection {
  id: SettingsSectionId;
  label: string;
  description: string;
  Icon: typeof Sparkles;
}

export interface ConnectionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManageAi: boolean;
  canManageAccess: boolean;
  /** Section to show when the dialog opens (from a deep link). */
  initialSection?: SettingsSectionId | null;
  /** Called when the user switches sections, so the URL can follow. */
  onSectionChange?: (section: SettingsSectionId) => void;
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
      data-settings-panel
      className={cn('w-full max-w-3xl', !active && 'hidden')}
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
  initialSection = null,
  onSectionChange,
}: ConnectionsDialogProps) {
  const { language } = useLanguage();
  const copy = useMemo(() => getAccountSettingsCopy(language), [language]);
  const sections = useMemo(
    (): SettingsSection[] => {
      const base: SettingsSection[] = [
        { id: 'general', label: copy.t('general'), description: copy.t('generalDescription'), Icon: SlidersHorizontal },
        { id: 'ai', label: copy.t('aiGeneration'), description: copy.t('chooseGemini'), Icon: Sparkles },
        { id: 'publishing', label: copy.t('publishing'), description: copy.t('publishersDescription'), Icon: MonitorUp },
      ];
      return canManageAccess
        ? [...base, { id: 'access', label: copy.t('peopleAccess'), description: copy.t('peopleAccessSectionDescription'), Icon: Users }]
        : base;
    },
    [canManageAccess, copy],
  );
  const resolveSection = useCallback((candidate: SettingsSectionId | null | undefined) => (
    candidate && (candidate !== 'access' || canManageAccess) ? candidate : DEFAULT_SECTION
  ), [canManageAccess]);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(() => resolveSection(initialSection));
  const [visitedSections, setVisitedSections] = useState<Set<SettingsSectionId>>(
    () => new Set([resolveSection(initialSection)]),
  );
  const [hasUncopiedEnrollmentAccess, setHasUncopiedEnrollmentAccess] = useState(false);
  const [hasUncopiedPairing, setHasUncopiedPairing] = useState(false);
  const [closeWarningOpen, setCloseWarningOpen] = useState(false);
  const [settingsSessionEpoch, setSettingsSessionEpoch] = useState(0);
  const settingsSessionEpochRef = useRef(0);
  const previousOpenRef = useRef(open);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const tabListRef = useRef<HTMLDivElement | null>(null);
  const [tabOverflow, setTabOverflow] = useState({ start: false, end: false });
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
    // A fresh open honors the requested section (deep link or menu default).
    if (!wasOpen && open && !hasSensitiveValue) {
      const next = resolveSection(initialSection);
      setActiveSection(next);
      setVisitedSections(new Set([next]));
    }
  }, [hasSensitiveValue, initialSection, invalidateSettingsSession, open, resolveSection]);

  useEffect(() => {
    if (!open && hasSensitiveValue) setCloseWarningOpen(true);
  }, [hasSensitiveValue, open]);

  useEffect(() => {
    if (hasSensitiveValue) return;
    setCloseWarningOpen(false);
    if (!open) {
      setActiveSection(DEFAULT_SECTION);
      setVisitedSections(new Set([DEFAULT_SECTION]));
    }
  }, [hasSensitiveValue, open]);

  useEffect(() => {
    if (!canManageAccess && activeSection === 'access') {
      setActiveSection(DEFAULT_SECTION);
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

  // On narrow screens the section list scrolls sideways; show which edges
  // hide more sections and keep the active one in view.
  const updateTabOverflow = useCallback(() => {
    const list = tabListRef.current;
    if (!list) return;
    const start = list.scrollLeft > 1;
    const end = list.scrollLeft + list.clientWidth < list.scrollWidth - 1;
    setTabOverflow((current) => (
      current.start === start && current.end === end ? current : { start, end }
    ));
  }, []);

  useEffect(() => {
    if (!effectiveOpen) return;
    const frame = window.requestAnimationFrame(() => {
      const list = tabListRef.current;
      const active = list?.querySelector<HTMLElement>('[data-state="active"]');
      if (list && active && list.scrollWidth > list.clientWidth) {
        const left = active.offsetLeft - 8;
        const right = active.offsetLeft + active.offsetWidth + 8 - list.clientWidth;
        if (left < list.scrollLeft) list.scrollLeft = left;
        else if (right > list.scrollLeft) list.scrollLeft = right;
      }
      updateTabOverflow();
    });
    window.addEventListener('resize', updateTabOverflow);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', updateTabOverflow);
    };
  }, [activeSection, effectiveOpen, sections, updateTabOverflow]);

  const selectSection = (next: string) => {
    const section = sections.find((candidate) => candidate.id === next);
    if (!section) return;
    if (section.id !== activeSection) onSectionChange?.(section.id);
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
    // Wait for the section to become visible, then bring the code into view.
    window.requestAnimationFrame(() => {
      const panel = contentRef.current?.querySelector(
        `[data-settings-section-id="${sensitiveSection}"]`,
      );
      revealOneTimeValue(panel);
    });
  };

  const discardAndClose = () => {
    invalidateSettingsSession();
    setHasUncopiedEnrollmentAccess(false);
    setHasUncopiedPairing(false);
    setCloseWarningOpen(false);
    onOpenChange(false);
  };

  const sectionById = (id: SettingsSectionId) => sections.find((section) => section.id === id);
  const renderPanel = (id: SettingsSectionId, body: ReactNode) => {
    const section = sectionById(id);
    if (!section || !visitedSections.has(id)) return null;
    return (
      <TabsContent
        value={id}
        forceMount
        data-settings-section-id={id}
        className="m-0 data-[state=inactive]:hidden"
      >
        <SettingsPanel labelledBy={`settings-${id}-title`} active={activeSection === id}>
          <SettingsSectionHeader
            id={`settings-${id}-title`}
            title={section.label}
            description={section.description}
          />
          {body}
        </SettingsPanel>
      </TabsContent>
    );
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
        className="!h-[min(46rem,calc(100dvh-1.5rem))] !w-[calc(100%-1.5rem)] !max-w-4xl grid-cols-1 grid-rows-[minmax(0,1fr)] gap-0 overflow-hidden rounded-xl border-border/80 bg-card p-0 shadow-lg sm:!h-[min(46rem,calc(100dvh-2rem))] sm:!w-[calc(100%-2rem)]"
      >
        <Tabs
          value={activeSection}
          onValueChange={selectSection}
          className="grid h-full min-h-0 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] gap-0 md:grid-cols-[14rem_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)]"
        >
          <aside
            data-connections-settings-rail
            aria-label={copy.t('settingsNavigation')}
            className="min-w-0 border-b border-border/70 md:flex md:min-h-0 md:flex-col md:border-b-0 md:border-r md:bg-muted/30"
          >
            <div className="flex h-14 items-center pl-4 pr-14 md:h-auto md:px-5 md:pb-4 md:pt-5">
              <DialogTitle className="truncate text-base font-semibold leading-6">
                {copy.t('accountSettings')}
              </DialogTitle>
              <DialogDescription className="sr-only">
                {copy.t('manageAccount')}
              </DialogDescription>
            </div>

            <div className="relative">
              <TabsList
                ref={tabListRef}
                onScroll={updateTabOverflow}
                aria-label={copy.t('settingsSections')}
                className="h-auto w-full justify-start gap-1 overflow-x-auto bg-transparent px-2 pb-2 [scrollbar-width:none] md:flex-col md:items-stretch md:overflow-visible md:px-3 md:pb-3 [&::-webkit-scrollbar]:hidden"
              >
                {sections.map(({ id, label, Icon }) => (
                  <TabsTrigger
                    key={id}
                    value={id}
                    data-settings-nav-item={id}
                    onClick={() => selectSection(id)}
                    onFocus={() => selectSection(id)}
                    onKeyDown={(event) => handleTabKeyDown(event, id)}
                    className="h-11 min-w-11 flex-none justify-start gap-2.5 rounded-lg border-0 px-3 text-sm font-medium text-muted-foreground shadow-none hover:bg-muted/60 hover:text-foreground data-[state=active]:bg-accent data-[state=active]:text-foreground data-[state=active]:shadow-none md:w-full"
                  >
                    <Icon aria-hidden="true" className="size-4 shrink-0" />
                    <span className="truncate">{label}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
              {tabOverflow.start ? (
                <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-card to-transparent md:hidden" />
              ) : null}
              {tabOverflow.end ? (
                <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-card to-transparent md:hidden" />
              ) : null}
            </div>
          </aside>

          <div
            ref={contentRef}
            data-connections-settings-content
            className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)]"
          >
            {closeWarningOpen ? (
              <div
                role="alert"
                className="mx-3 mt-3 flex flex-col gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm sm:flex-row sm:items-center sm:justify-between md:mx-8 md:mr-16 md:mt-5"
              >
                <div className="flex min-w-0 gap-2.5">
                  <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">
                      {copy.t(sensitiveSection === 'publishing' ? 'unsavedPairingCode' : 'unsavedEnrollmentCode')}
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      {copy.t('unsavedCodeDescription')}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={reviewSensitiveValue}>
                    {copy.t('reviewCode')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-destructive-text hover:bg-destructive/10 hover:text-destructive-text"
                    onClick={discardAndClose}
                  >
                    {copy.t('discardAndClose')}
                  </Button>
                </div>
              </div>
            ) : null}

            <div
              data-connections-dialog-scroll
              className="min-h-0 overflow-y-auto overscroll-contain px-4 pb-8 pt-5 md:px-8 md:pt-6"
            >
              {renderPanel('general', <GeneralSettingsSection copy={copy} />)}
              {renderPanel('ai', (
                <WorkspaceAiCredentialCard canManageAi={canManageAi} />
              ))}
              {renderPanel('publishing', (
                <PublisherDevicePairingCard onUncopiedPairingChange={handleUncopiedPairingChange} />
              ))}
              {canManageAccess ? renderPanel('access', (
                <AdminPeopleAccessCard onUncopiedAccessChange={handleUncopiedEnrollmentAccessChange} />
              )) : null}
            </div>
          </div>
        </Tabs>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-1.5 top-1.5 z-30 size-11 rounded-lg text-muted-foreground hover:text-foreground md:right-3 md:top-3 md:size-9"
          aria-label={copy.t('closeAccountSettings')}
          onClick={requestClose}
        >
          <X aria-hidden="true" className="size-4" />
        </Button>
      </DialogContent>
    </Dialog>
  );
}
