'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Check, KeyRound, Loader2, RefreshCw, Trash2 } from 'lucide-react';

import { useLanguage } from '@/components/language-provider';
import { Badge } from '@/components/ui/badge';
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="size-4" aria-hidden="true" />
            {copy.t('geminiConnection')}
          </CardTitle>
          <CardDescription>{copy.t('loadingAccountConnection')}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!canManage) {
    return (
      <Card className={cn('border-dashed', className)}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="size-4" aria-hidden="true" />
            {copy.t('geminiConnection')}
          </CardTitle>
          <CardDescription>
            {copy.t('noPersonalKey')}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!statusQuery.data && statusQuery.isLoading) {
    return (
      <Card className={className} aria-busy="true">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="size-4" aria-hidden="true" />
            {copy.t('geminiConnection')}
          </CardTitle>
          <CardDescription>{copy.t('checkingConnection')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            {copy.t('loadingGeminiConnection')}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!statusQuery.data && statusQuery.error) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="size-4" aria-hidden="true" />
            {copy.t('geminiConnection')}
          </CardTitle>
          <CardDescription>
            {copy.t('addKeyDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p role="alert" className="text-sm text-destructive">
            {accountSettingsErrorMessage(statusQuery.error, copy, 'connectionCouldNotLoad')}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => void statusQuery.refetch()}
            disabled={statusQuery.isFetching}
          >
            {statusQuery.isFetching ? (
              <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="mr-2 size-4" aria-hidden="true" />
            )}
            {copy.t('retry')}
          </Button>
        </CardContent>
      </Card>
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

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="size-4" aria-hidden="true" />
          {copy.t('geminiConnection')}
          {status?.configured ? (
            <Badge variant="outline" className="ml-auto gap-1 rounded-full text-[0.65rem]">
              <Check className="size-3" aria-hidden="true" /> {copy.t('configured')}
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription>
          {copy.t('geminiKeyDescription')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={submit} className="space-y-2">
          <label htmlFor="account-gemini-key" className="text-sm font-medium">
            {status?.configured ? copy.t('replaceGeminiKey') : copy.t('yourGeminiKey')}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
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
              {saveMutation.isPending ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
              {status?.configured ? copy.t('replace') : copy.t('save')}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {copy.t('onlyGeminiKeys')}
          </p>
        </form>

        <div className="rounded-lg border border-border/70 p-3">
          <div className="mb-2 text-sm font-medium">{copy.t('generationSource')}</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {([
              ['platform', copy.t('platformCredits'), copy.t('platformCreditsDescription')],
              ['workspace', copy.t('yourGeminiKey'), copy.t('yourGeminiKeyDescription')],
            ] as const).map(([source, label, description]) => (
              <button
                key={source}
                type="button"
                onClick={() => void changeSource(source)}
                disabled={busy || (source === 'workspace' && !status?.configured)}
                className={cn(
                  'rounded-md border p-3 text-left transition-colors',
                  activeSource === source
                    ? 'border-primary bg-primary/5'
                    : 'border-border/70 hover:bg-muted/40',
                  source === 'workspace' && !status?.configured && 'cursor-not-allowed opacity-50',
                )}
                aria-pressed={activeSource === source}
              >
                <span className="block text-sm font-medium">{label}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{description}</span>
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {copy.t('active')}: <span className="font-medium text-foreground">{activeSource === 'workspace' ? copy.t('yourGeminiKey') : copy.t('platformCredits')}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {status?.configured ? (
            <span aria-label={copy.t('storedKey')}>{copy.t('storedKey')}: <span className="font-mono tracking-[0.16em] text-foreground">••••••••••••••••</span></span>
          ) : null}
          <span>{copy.t('validated')}: {formatAccountSettingsDate(language, status?.validatedAt, copy.t('notYet'))}</span>
          <span>{copy.t('updated')}: {formatAccountSettingsDate(language, status?.updatedAt, copy.t('notYet'))}</span>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => void testConnection()} disabled={busy || !status?.configured}>
            {testMutation.isPending ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="mr-2 size-4" aria-hidden="true" />}
            {copy.t('testConnection')}
          </Button>
          <Button type="button" variant="ghost" onClick={requestDeleteConnection} disabled={busy || !status?.configured}>
            <Trash2 className="mr-2 size-4" aria-hidden="true" />
            {copy.t('deleteKey')}
          </Button>
        </div>

        {statusQuery.isLoading ? <p className="text-sm text-muted-foreground">{copy.t('loadingGeminiConnection')}</p> : null}
        {actionError ? <p role="alert" className="text-sm text-destructive">{accountSettingsErrorMessage(actionError, copy, 'connectionRequestFailed')}</p> : null}
        {notice ? <p role="status" className="text-sm text-muted-foreground">{notice}</p> : null}
      </CardContent>

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
    </Card>
  );
}
