'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { KeyRound, Loader2, RefreshCw, Trash2 } from 'lucide-react';

import { useLanguage } from '@/components/language-provider';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { SettingsGroup, StatusBadge } from '@/components/settings/settings-primitives';
import { Input } from '@/components/ui/input';
import {
  useDeleteWorkspaceAiCredential,
  useSaveWorkspaceAiCredential,
  useSetWorkspaceAiCredentialSource,
  useTestWorkspaceAiCredential,
  useWorkspaceAiCredential,
  type WorkspaceAiCredentialSource,
} from '@/lib/hooks';
import {
  accountSettingsErrorMessage,
  formatAccountSettingsDate,
  getAccountSettingsCopy,
} from '@/lib/account-settings-i18n';
import { cn } from '@/lib/utils';

type WorkspaceRole = 'owner' | 'member' | null | undefined;

type WorkspaceAiCredentialCardProps = {
  canManageAi?: boolean;
  /** @deprecated Account Settings should pass canManageAi. */
  workspaceRole?: WorkspaceRole;
  className?: string;
};

export function WorkspaceAiCredentialCard({
  canManageAi,
  workspaceRole,
  className,
}: WorkspaceAiCredentialCardProps) {
  const { language } = useLanguage();
  const copy = useMemo(() => getAccountSettingsCopy(language), [language]);
  const permissionResolved = typeof canManageAi === 'boolean' || workspaceRole !== undefined;
  const canManage = canManageAi ?? workspaceRole === 'owner';
  const statusQuery = useWorkspaceAiCredential(canManage);
  const saveMutation = useSaveWorkspaceAiCredential();
  const testMutation = useTestWorkspaceAiCredential();
  const sourceMutation = useSetWorkspaceAiCredentialSource();
  const deleteMutation = useDeleteWorkspaceAiCredential();
  const apiKeyInputRef = useRef<HTMLInputElement>(null);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteConfirmPending, setDeleteConfirmPending] = useState(false);
  const [deleteConfirmError, setDeleteConfirmError] = useState<string | null>(null);

  useEffect(() => {
    if (statusQuery.data?.activeSource === 'workspace' && !statusQuery.data.configured) {
      setNotice(copy.t('savedKeyUnavailable'));
    }
  }, [copy, statusQuery.data]);

  if (!permissionResolved) {
    return (
      <div className={cn('w-full', className)}>
        <p className="text-sm text-muted-foreground">{copy.t('loadingAccountConnection')}</p>
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className={cn('w-full', className)}>
        <div className="flex items-start gap-3 rounded-lg border border-dashed border-border/80 p-4">
          <KeyRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-foreground">{copy.t('geminiConnection')}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{copy.t('noPersonalKey')}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!statusQuery.data && statusQuery.isLoading) {
    return (
      <div className={cn('w-full', className)} aria-busy="true">
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          {copy.t('loadingGeminiConnection')}
        </p>
      </div>
    );
  }

  if (!statusQuery.data && statusQuery.error) {
    return (
      <div className={cn('w-full', className)}>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <p role="alert" className="text-sm text-destructive">
            {accountSettingsErrorMessage(statusQuery.error, copy, 'connectionCouldNotLoad')}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void statusQuery.refetch()}
            disabled={statusQuery.isFetching}
          >
            {statusQuery.isFetching ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="size-4" aria-hidden="true" />
            )}
            {copy.t('retry')}
          </Button>
        </div>
      </div>
    );
  }

  const status = statusQuery.data;
  const busy = saveMutation.isPending
    || testMutation.isPending
    || sourceMutation.isPending
    || deleteMutation.isPending
    || deleteConfirmPending;
  const activeSource: WorkspaceAiCredentialSource = status?.activeSource ?? 'platform';

  const clearActionFeedback = () => {
    setNotice(null);
    setActionError(null);
    saveMutation.reset?.();
    testMutation.reset?.();
    sourceMutation.reset?.();
    deleteMutation.reset?.();
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    clearActionFeedback();
    const value = apiKeyInputRef.current?.value ?? '';
    if (apiKeyInputRef.current) apiKeyInputRef.current.value = '';
    setHasApiKey(false);
    if (!value.trim()) return;
    try {
      const savedStatus = await saveMutation.mutateAsync(value);
      setNotice(savedStatus.activeSource === 'workspace'
        ? copy.t('keyValidatedReplaced')
        : copy.t('keyValidatedSaved'));
    } catch (error) {
      // Keep the mutation error only for this action; the key is already cleared.
      setActionError(error);
    }
  };

  const changeSource = async (source: WorkspaceAiCredentialSource) => {
    if (source === activeSource || busy) return;
    clearActionFeedback();
    try {
      await sourceMutation.mutateAsync(source);
      setNotice(source === 'workspace'
        ? copy.t('keyNowActive')
        : copy.t('creditsNowActive'));
    } catch (error) {
      setActionError(error);
    }
  };

  const testConnection = async () => {
    clearActionFeedback();
    try {
      await testMutation.mutateAsync();
      setNotice(copy.t('connectionWorking'));
    } catch (error) {
      setActionError(error);
    }
  };

  const requestDeleteConnection = () => {
    if (busy) return;
    clearActionFeedback();
    setDeleteConfirmError(null);
    setDeleteConfirmOpen(true);
  };

  const deleteConnection = async () => {
    if (deleteConfirmPending) return;
    clearActionFeedback();
    setDeleteConfirmError(null);
    setDeleteConfirmPending(true);
    try {
      await deleteMutation.mutateAsync();
      setNotice(copy.t('keyDeleted'));
      setDeleteConfirmOpen(false);
    } catch (deleteError) {
      setDeleteConfirmError(accountSettingsErrorMessage(deleteError, copy, 'keyCouldNotDelete'));
    } finally {
      setDeleteConfirmPending(false);
    }
  };

  const feedback = (
    <>
      {statusQuery.isLoading ? <p className="text-sm text-muted-foreground">{copy.t('loadingGeminiConnection')}</p> : null}
      {actionError ? <p role="alert" className="text-sm text-destructive">{accountSettingsErrorMessage(actionError, copy, 'connectionRequestFailed')}</p> : null}
      {notice ? <p role="status" className="text-sm text-muted-foreground">{notice}</p> : null}
    </>
  );

  return (
    <div className={cn('w-full space-y-6', className)}>
      <SettingsGroup title={copy.t('generationSource')} titleId="ai-generation-source-title">
        <div
          role="radiogroup"
          aria-labelledby="ai-generation-source-title"
          className="grid gap-2 sm:grid-cols-2"
        >
          {([
            ['platform', copy.t('platformCredits'), copy.t('platformCreditsDescription')],
            ['workspace', copy.t('yourGeminiKey'), copy.t('yourGeminiKeyDescription')],
          ] as const).map(([source, label, description]) => {
            const unavailable = source === 'workspace' && !status?.configured;
            const checked = activeSource === source;
            return (
              <label
                key={source}
                className={cn(
                  'flex cursor-pointer gap-3 rounded-lg border p-3 text-left transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
                  checked ? 'border-foreground/50 bg-muted/50' : 'border-border/70 hover:bg-muted/40',
                  (unavailable || busy) && 'cursor-not-allowed',
                  unavailable && 'opacity-60',
                )}
              >
                <input
                  type="radio"
                  name="ai-generation-source"
                  value={source}
                  checked={checked}
                  disabled={busy || unavailable}
                  onChange={() => void changeSource(source)}
                  className="mt-0.5 size-4 shrink-0 accent-foreground"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">{label}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{description}</span>
                </span>
              </label>
            );
          })}
        </div>
      </SettingsGroup>

      <SettingsGroup
        title={copy.t('geminiConnection')}
        titleId="ai-gemini-key-title"
        description={copy.t('geminiKeyDescription')}
        actions={status?.configured ? (
          <StatusBadge tone="success">{copy.t('configured')}</StatusBadge>
        ) : null}
      >
        <div className="space-y-4">
          {status?.configured ? (
            <div className="flex flex-col gap-3 rounded-lg border border-border/70 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span aria-label={copy.t('storedKey')}>{copy.t('storedKey')}: <span className="font-mono text-foreground">••••••••</span></span>
                <span>{copy.t('validated')}: {formatAccountSettingsDate(language, status?.validatedAt, copy.t('notYet'))}</span>
                <span>{copy.t('updated')}: {formatAccountSettingsDate(language, status?.updatedAt, copy.t('notYet'))}</span>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => void testConnection()} disabled={busy || !status?.configured}>
                  {testMutation.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="size-4" aria-hidden="true" />}
                  {copy.t('testConnection')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-destructive-text hover:bg-destructive/10 hover:text-destructive-text"
                  onClick={requestDeleteConnection}
                  disabled={busy || !status?.configured}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                  {copy.t('deleteKey')}
                </Button>
              </div>
            </div>
          ) : null}

          <form onSubmit={submit} className="space-y-2">
            <label htmlFor="account-gemini-key" className="text-sm font-medium">
              {status?.configured ? copy.t('replaceGeminiKey') : copy.t('yourGeminiKey')}
            </label>
            <div className="flex max-w-xl flex-col gap-2 sm:flex-row">
              <Input
                ref={apiKeyInputRef}
                id="account-gemini-key"
                name="apiKey"
                type="password"
                autoComplete="new-password"
                onChange={(event) => setHasApiKey(Boolean(event.target.value.trim()))}
                placeholder={copy.t('pasteGeminiKey')}
                minLength={20}
                maxLength={512}
                disabled={busy}
              />
              <Button type="submit" disabled={busy || !hasApiKey}>
                {saveMutation.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                {status?.configured ? copy.t('replace') : copy.t('save')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {copy.t('onlyGeminiKeys')}
            </p>
            {feedback}
          </form>
        </div>
      </SettingsGroup>

      <AlertDialog
        open={deleteConfirmOpen}
        onOpenChange={(open) => {
          if (deleteConfirmPending) return;
          setDeleteConfirmOpen(open);
          if (!open) setDeleteConfirmError(null);
        }}
      >
        <AlertDialogContent className="console-dialog border-dotted p-4 sm:max-w-md sm:p-5">
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.t('deleteKeyQuestion')}</AlertDialogTitle>
            <AlertDialogDescription>
              {copy.t('deleteKeyDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteConfirmError ? (
            <p role="alert" className="text-sm text-destructive">
              {deleteConfirmError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteConfirmPending}>{copy.t('keepKey')}</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteConfirmPending}
              onClick={() => void deleteConnection()}
            >
              {deleteConfirmPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
              ) : null}
              {copy.t('deleteKey')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
