'use client';

import { useDeferredValue, useState } from 'react';
import Link from 'next/link';
import {
  Clock3,
  Copy,
  FileKey2,
  FileText,
  FolderOpenDot,
  KeyRound,
  Layers3,
  MessageSquarePlus,
  Search,
  Sparkles,
} from 'lucide-react';

import { DeckCard } from '@/components/deck-card';
import { LanguageToggle } from '@/components/language-toggle';
import { useLanguage } from '@/components/language-provider';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { formatRelativeTime } from '@/lib/i18n';
import { useDecks, useRecoverWorkspace, useWorkspace } from '@/lib/hooks';

type DeckListItem = {
  id: string;
  title: string;
  description?: string | null;
  status?: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: {
    slides?: number;
  };
};

const sidebarSkeletonWidths = ['88%', '64%', '76%', '58%', '71%', '67%'] as const;

function DeckSidebarList({
  decks,
  isLoading,
  isError,
  query,
  onQueryChange,
  language,
  accessKeyPrefix,
}: {
  decks: DeckListItem[];
  isLoading: boolean;
  isError: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  language: 'km' | 'en';
  accessKeyPrefix?: string | null;
}) {
  const { messages } = useLanguage();

  return (
    <>
      <SidebarHeader className="gap-3 border-b border-sidebar-border/70 p-3">
        <Link href="/" className="flex min-w-0 items-center gap-3 px-2 py-2">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center bg-sidebar-primary text-sidebar-primary-foreground">
            <Layers3 className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-sidebar-foreground">xArticle</p>
            <p className="truncate text-xs text-sidebar-foreground/70">
              {messages.dashboard.workspaceDashboard}
            </p>
          </div>
        </Link>

        <Button asChild className="h-10 justify-start">
          <Link href="/new">
            <MessageSquarePlus className="h-4 w-4" />
            {messages.common.newDeck}
          </Link>
        </Button>

        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sidebar-foreground/60" />
          <input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={messages.dashboard.searchDecks}
            className="h-10 w-full border border-sidebar-border/70 bg-background pl-9 pr-3 text-sm text-foreground shadow-none outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
          />
        </label>
      </SidebarHeader>

      <SidebarContent className="px-2 py-3">
        <SidebarGroup className="pt-0">
          <SidebarGroupLabel>{messages.dashboard.allDecks}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {isLoading ? (
                sidebarSkeletonWidths.map((width, index) => (
                  <SidebarMenuSkeleton key={index} showIcon width={width} />
                ))
              ) : isError ? (
                <div className="border border-destructive/20 bg-destructive/5 px-3 py-4 text-sm text-sidebar-foreground/80">
                  {messages.dashboard.couldNotLoadDeckList}
                </div>
              ) : decks.length > 0 ? (
                decks.map((deck) => (
                  <SidebarMenuItem key={deck.id}>
                    <SidebarMenuButton asChild className="h-auto px-3 py-3">
                      <Link href={`/articles/${deck.id}`}>
                        <FolderOpenDot className="mt-0.5 h-4 w-4 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{deck.title}</p>
                          <p className="mt-1 truncate text-xs text-sidebar-foreground/65">
                            {deck.description ||
                              `${deck._count?.slides || 0} ${messages.deckCard.slides.toLowerCase()} • ${messages.deckCard.updated} ${formatRelativeTime(new Date(deck.updatedAt), language)}`}
                          </p>
                        </div>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))
              ) : (
                <div className="border border-sidebar-border/70 bg-background px-3 py-4 text-sm text-sidebar-foreground/70">
                  {query ? messages.dashboard.noMatchingDecks : messages.dashboard.noDecksYet}
                </div>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarSeparator />

      <SidebarFooter className="p-3">
        <div className="border border-sidebar-border/70 bg-background px-3 py-3">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-sidebar-foreground/60">
            {messages.dashboard.privateWorkspace}
          </p>
          <p className="mt-2 text-sm text-sidebar-foreground/80">
            {messages.dashboard.workspaceDescription}
          </p>
          {accessKeyPrefix ? (
            <p className="mt-3 text-xs text-sidebar-foreground/65">
              {messages.dashboard.accessKeyPrefixLabel}: {accessKeyPrefix}
            </p>
          ) : null}
        </div>
      </SidebarFooter>
    </>
  );
}

export function DashboardHome() {
  const { language, messages } = useLanguage();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showRecoveryForm, setShowRecoveryForm] = useState(false);
  const [recoveryKeyInput, setRecoveryKeyInput] = useState('');
  const [workspaceNotice, setWorkspaceNotice] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const deferredQuery = useDeferredValue(query);
  const { data, isLoading, isError, refetch } = useDecks();
  const workspaceQuery = useWorkspace();
  const recoverWorkspace = useRecoverWorkspace();
  const decks = (data ?? []) as DeckListItem[];

  const filteredDecks = decks.filter((deck) => {
    if (deferredQuery.trim()) {
      const needle = deferredQuery.trim().toLowerCase();
      if (
        !deck.title.toLowerCase().includes(needle) &&
        !deck.description?.toLowerCase().includes(needle)
      ) {
        return false;
      }
    }

    if (statusFilter !== 'all' && deck.status !== statusFilter) {
      return false;
    }

    return true;
  });

  const handleCopyAccessKey = async () => {
    const recoveryKey = workspaceQuery.data?.recoveryKey;
    if (!recoveryKey) {
      return;
    }

    try {
      await navigator.clipboard.writeText(recoveryKey);
      setWorkspaceError(null);
      setWorkspaceNotice(messages.dashboard.accessKeyCopied);
    } catch {
      setWorkspaceError(messages.dashboard.copyAccessKeyFailed);
    }
  };

  const handleRecoverWorkspace = () => {
    const trimmedKey = recoveryKeyInput.trim();
    if (!trimmedKey) {
      setWorkspaceError(messages.dashboard.accessKeyRequired);
      return;
    }

    setWorkspaceNotice(null);
    setWorkspaceError(null);

    recoverWorkspace.mutate(trimmedKey, {
      onSuccess: async () => {
        setRecoveryKeyInput('');
        setShowRecoveryForm(false);
        setWorkspaceNotice(messages.dashboard.workspaceRecovered);
        await refetch();
      },
      onError: (error) => {
        setWorkspaceError(
          error instanceof Error ? error.message : messages.dashboard.recoverWorkspaceFailed
        );
      },
    });
  };

  return (
    <SidebarProvider defaultOpen className="min-h-screen w-full bg-background">
      <Sidebar className="z-30 border-r border-sidebar-border/70" collapsible="offcanvas">
        <DeckSidebarList
          decks={filteredDecks}
          isLoading={isLoading}
          isError={isError}
          query={query}
          onQueryChange={setQuery}
          language={language}
          accessKeyPrefix={workspaceQuery.data?.accessKeyPrefix}
        />
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(120,119,198,0.06),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(56,189,248,0.08),transparent_30%)]">
        <header className="sticky top-0 z-10 border-b border-border/70 bg-background/85 backdrop-blur">
          <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
            <SidebarTrigger className="size-9 border border-border/70" />

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground sm:text-base">
                {messages.dashboard.headerTitle}
              </p>
            </div>

            <LanguageToggle />
            <ThemeToggle />

            <Button asChild className="px-4 sm:px-5">
              <Link href="/new">
                <MessageSquarePlus className="h-4 w-4" />
                <span className="hidden sm:inline">{messages.common.newDeck}</span>
              </Link>
            </Button>
          </div>
        </header>

        <div className="flex-1 px-4 py-6 sm:px-6 sm:py-8">
          <div className="mx-auto flex w-full flex-col gap-10">
            <section className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
              {workspaceQuery.data?.recoveryKey ? (
                <div className="border border-primary/25 bg-primary/5 p-5">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 items-center justify-center bg-primary/10 text-primary">
                      <FileKey2 className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h2 className="text-lg font-semibold text-foreground">
                        {messages.dashboard.saveAccessKeyTitle}
                      </h2>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {messages.dashboard.saveAccessKeyDescription}
                      </p>
                      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                        <div className="min-w-0 flex-1 border border-border bg-background px-3 py-3 font-mono text-sm text-foreground">
                          {workspaceQuery.data.recoveryKey}
                        </div>
                        <Button onClick={handleCopyAccessKey} className="gap-2">
                          <Copy className="h-4 w-4" />
                          {messages.dashboard.copyAccessKey}
                        </Button>
                      </div>
                      <p className="mt-3 text-xs text-muted-foreground">
                        {messages.dashboard.accessKeyPrefixLabel}:{' '}
                        {workspaceQuery.data.accessKeyPrefix}
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="border border-border/60 bg-background/80 p-5">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 items-center justify-center bg-muted text-foreground">
                      <KeyRound className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h2 className="text-lg font-semibold text-foreground">
                        {messages.dashboard.privateWorkspace}
                      </h2>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {messages.dashboard.workspaceDescription}
                      </p>
                      {workspaceQuery.data?.accessKeyPrefix ? (
                        <p className="mt-3 text-xs text-muted-foreground">
                          {messages.dashboard.accessKeyPrefixLabel}:{' '}
                          {workspaceQuery.data.accessKeyPrefix}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              )}

              <div className="border border-border/60 bg-background/80 p-5">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center bg-[#F0B90B]/10 text-[#F0B90B]">
                    <KeyRound className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-semibold text-foreground">
                      {messages.dashboard.useAccessKeyTitle}
                    </h2>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {messages.dashboard.useAccessKeyDescription}
                    </p>
                    {showRecoveryForm ? (
                      <div className="mt-4 flex flex-col gap-3">
                        <Input
                          value={recoveryKeyInput}
                          onChange={(event) => setRecoveryKeyInput(event.target.value)}
                          placeholder={messages.dashboard.accessKeyPlaceholder}
                          disabled={recoverWorkspace.isPending}
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button
                            onClick={handleRecoverWorkspace}
                            disabled={recoverWorkspace.isPending}
                          >
                            {recoverWorkspace.isPending
                              ? messages.dashboard.recoveringWorkspace
                              : messages.dashboard.useAccessKeyAction}
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => {
                              setShowRecoveryForm(false);
                              setRecoveryKeyInput('');
                              setWorkspaceError(null);
                            }}
                            disabled={recoverWorkspace.isPending}
                          >
                            {messages.common.cancel}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        className="mt-4"
                        onClick={() => {
                          setShowRecoveryForm(true);
                          setWorkspaceNotice(null);
                          setWorkspaceError(null);
                        }}
                      >
                        {messages.dashboard.useAccessKeyAction}
                      </Button>
                    )}
                    {workspaceNotice ? (
                      <p className="mt-3 text-sm font-medium text-primary">{workspaceNotice}</p>
                    ) : null}
                    {workspaceError ? (
                      <p className="mt-3 text-sm text-destructive">{workspaceError}</p>
                    ) : null}
                  </div>
                </div>
              </div>
            </section>

            <section className="space-y-4">
              <h2 className="text-xl font-semibold tracking-tight text-foreground">
                {messages.dashboard.quickStart}
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Link
                  href="/new"
                  className="group flex flex-col justify-between border border-border/60 bg-background/80 p-5 shadow-sm transition-all hover:-translate-y-1 hover:border-foreground/20 hover:shadow-md"
                >
                  <div className="mb-4 flex h-10 w-10 items-center justify-center bg-primary/10 text-primary">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-medium text-foreground group-hover:underline">
                      {messages.dashboard.startFromText}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {messages.dashboard.startFromTextDesc}
                    </p>
                  </div>
                </Link>

                <Link
                  href="/new?mode=url"
                  className="group flex flex-col justify-between border border-border/60 bg-background/80 p-5 shadow-sm transition-all hover:-translate-y-1 hover:border-foreground/20 hover:shadow-md"
                >
                  <div className="mb-4 flex h-10 w-10 items-center justify-center bg-[#02C076]/10 text-[#02C076]">
                    <Layers3 className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-medium text-foreground group-hover:underline">
                      {messages.dashboard.importFromUrl}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {messages.dashboard.importFromUrlDesc}
                    </p>
                  </div>
                </Link>

                <Link
                  href="/new?mode=prompt"
                  className="group flex flex-col justify-between border border-border/60 bg-background/80 p-5 shadow-sm transition-all hover:-translate-y-1 hover:border-foreground/20 hover:shadow-md sm:col-span-2 lg:col-span-1"
                >
                  <div className="mb-4 flex h-10 w-10 items-center justify-center bg-[#F0B90B]/10 text-[#F0B90B]">
                    <Sparkles className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-medium text-foreground group-hover:underline">
                      {messages.dashboard.generateWithAI}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {messages.dashboard.generateWithAIDesc}
                    </p>
                  </div>
                </Link>
              </div>
            </section>

            {isLoading ? (
              <section className="grid gap-5 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div
                    key={index}
                    className="border border-border/70 bg-background/88 p-6 shadow-[0_28px_80px_-60px_rgba(15,23,42,0.28)]"
                  >
                    <div className="animate-pulse space-y-5">
                      <div className="h-5 w-24 bg-foreground/10" />
                      <div className="space-y-3">
                        <div className="h-6 w-3/4 bg-foreground/10" />
                        <div className="h-4 w-full bg-foreground/8" />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="h-20 bg-foreground/8" />
                        <div className="h-20 bg-foreground/8" />
                      </div>
                    </div>
                  </div>
                ))}
              </section>
            ) : isError ? (
              <section className="border border-destructive/25 bg-destructive/5 p-8">
                <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                  {messages.dashboard.loadErrorTitle}
                </h2>
                <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
                  {messages.dashboard.loadErrorDescription}
                </p>
                <Button variant="outline" className="mt-5" onClick={() => refetch()}>
                  {messages.common.retry}
                </Button>
              </section>
            ) : decks.length > 0 ? (
              <section className="space-y-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <Clock3 className="h-4 w-4 text-muted-foreground" />
                    <h2 className="text-xl font-semibold tracking-tight text-foreground">
                      {messages.dashboard.continueRecent}
                    </h2>
                  </div>

                  <div className="flex space-x-1 overflow-x-auto border border-border/60 bg-background/50 p-1">
                    {['all', 'draft', 'generating', 'generated', 'rendered'].map((status) => (
                      <button
                        key={status}
                        onClick={() => setStatusFilter(status)}
                        className={`whitespace-nowrap px-3 py-1 text-xs font-medium uppercase tracking-wider transition-colors ${
                          statusFilter === status
                            ? 'bg-foreground text-background'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        }`}
                      >
                        {messages.dashboard[
                          `filter${status.charAt(0).toUpperCase() + status.slice(1)}` as keyof typeof messages.dashboard
                        ] || status}
                      </button>
                    ))}
                  </div>
                </div>

                {filteredDecks.length > 0 ? (
                  <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
                    {filteredDecks.slice(0, 9).map((deck) => (
                      <DeckCard
                        key={deck.id}
                        id={deck.id}
                        title={deck.title}
                        description={deck.description ?? undefined}
                        slideCount={deck._count?.slides || 0}
                        createdAt={deck.createdAt}
                        updatedAt={deck.updatedAt}
                        status={deck.status ?? undefined}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="border border-dashed border-border/70 bg-background/50 py-12 text-center text-sm text-muted-foreground">
                    {messages.dashboard.noFilteredDecks.replace('{status}', statusFilter)}
                  </div>
                )}
              </section>
            ) : (
              <section className="border border-dashed border-border/70 bg-background/72 p-10 text-center">
                <div className="mx-auto max-w-2xl">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center bg-secondary text-foreground">
                    <Sparkles className="h-6 w-6" />
                  </div>
                  <h2 className="mt-6 text-3xl font-semibold tracking-tight text-foreground">
                    {messages.dashboard.emptyTitle}
                  </h2>
                  <p className="mt-3 text-base leading-8 text-muted-foreground">
                    {messages.dashboard.emptyDescription}
                  </p>
                  <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                    <Button asChild className="px-5">
                      <Link href="/new">
                        <MessageSquarePlus className="h-4 w-4" />
                        {messages.dashboard.createFirstDeck}
                      </Link>
                    </Button>
                    <div className="inline-flex items-center gap-2 border border-border/70 px-4 py-2 text-sm text-muted-foreground">
                      <FileText className="h-4 w-4" />
                      {messages.dashboard.pasteToBegin}
                    </div>
                  </div>
                </div>
              </section>
            )}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
