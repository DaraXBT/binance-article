'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, KeyRound, Loader2, RefreshCw, Trash2 } from 'lucide-react';

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
import { cn } from '@/lib/utils';

type WorkspaceRole = 'owner' | 'member' | null | undefined;

type WorkspaceAiCredentialCardProps = {
  canManageAi?: boolean;
  /** @deprecated Account Settings should pass canManageAi. */
  workspaceRole?: WorkspaceRole;
  className?: string;
};

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Not yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not yet';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function mutationMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function WorkspaceAiCredentialCard({
  canManageAi,
  workspaceRole,
  className,
}: WorkspaceAiCredentialCardProps) {
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
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteConfirmPending, setDeleteConfirmPending] = useState(false);
  const [deleteConfirmError, setDeleteConfirmError] = useState<string | null>(null);

  useEffect(() => {
    if (statusQuery.data?.activeSource === 'workspace' && !statusQuery.data.configured) {
      setNotice('Your saved Gemini key is no longer available. Platform credits remain active.');
    }
  }, [statusQuery.data]);

  if (!permissionResolved) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="size-4" aria-hidden="true" />
            Gemini connection
          </CardTitle>
          <CardDescription>Loading your account connection…</CardDescription>
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
            Gemini connection
          </CardTitle>
          <CardDescription>
            A personal Gemini key is not available for this account.
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
            Gemini connection
          </CardTitle>
          <CardDescription>Checking the saved connection status…</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Loading Gemini connection…
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
            Gemini connection
          </CardTitle>
          <CardDescription>
            Add a personal Gemini key to your account for article generation.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p role="alert" className="text-sm text-destructive">
            {mutationMessage(statusQuery.error, 'Gemini connection could not be loaded.')}
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
            Retry
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
  const error = statusQuery.error
    || saveMutation.error
    || testMutation.error
    || sourceMutation.error
    || (!deleteConfirmOpen ? deleteMutation.error : null);
  const activeSource: WorkspaceAiCredentialSource = status?.activeSource ?? 'platform';

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice(null);
    const value = apiKeyInputRef.current?.value ?? '';
    if (apiKeyInputRef.current) apiKeyInputRef.current.value = '';
    setHasApiKey(false);
    if (!value.trim()) return;
    try {
      const savedStatus = await saveMutation.mutateAsync(value);
      setNotice(savedStatus.activeSource === 'workspace'
        ? 'Gemini key validated and replaced. Your Gemini key remains active.'
        : 'Gemini key validated and saved. Platform credits remain active until you switch sources.');
    } catch {
      // The mutation exposes a sanitized error below; the key is already cleared.
    }
  };

  const changeSource = async (source: WorkspaceAiCredentialSource) => {
    if (source === activeSource || busy) return;
    setNotice(null);
    try {
      await sourceMutation.mutateAsync(source);
      setNotice(source === 'workspace'
        ? 'Your Gemini key is now active.'
        : 'Platform credits are now active.');
    } catch {
      // The mutation exposes a sanitized error below.
    }
  };

  const testConnection = async () => {
    setNotice(null);
    try {
      await testMutation.mutateAsync();
      setNotice('Gemini connection is working.');
    } catch {
      // The mutation exposes a sanitized error below.
    }
  };

  const requestDeleteConnection = () => {
    if (busy) return;
    deleteMutation.reset?.();
    setDeleteConfirmError(null);
    setDeleteConfirmOpen(true);
  };

  const deleteConnection = async () => {
    if (deleteConfirmPending) return;
    setNotice(null);
    setDeleteConfirmError(null);
    setDeleteConfirmPending(true);
    try {
      await deleteMutation.mutateAsync();
      setNotice('Your saved key was deleted. This does not revoke the key at Google.');
      setDeleteConfirmOpen(false);
    } catch (deleteError) {
      setDeleteConfirmError(mutationMessage(deleteError, 'Gemini key could not be deleted.'));
    } finally {
      setDeleteConfirmPending(false);
    }
  };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="size-4" aria-hidden="true" />
          Gemini connection
          {status?.configured ? (
            <Badge variant="outline" className="ml-auto gap-1 rounded-full text-[0.65rem]">
              <Check className="size-3" aria-hidden="true" /> Configured
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription>
          Add your own Gemini API key to your account. The key is encrypted before it is stored and is never shown again.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={submit} className="space-y-2">
          <label htmlFor="account-gemini-key" className="text-sm font-medium">
            {status?.configured ? 'Replace your Gemini key' : 'Your Gemini key'}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              ref={apiKeyInputRef}
              id="account-gemini-key"
              name="apiKey"
              type="password"
              autoComplete="new-password"
              onChange={(event) => setHasApiKey(Boolean(event.target.value.trim()))}
              placeholder="Paste a Gemini API key"
              minLength={20}
              maxLength={512}
              disabled={busy}
            />
            <Button type="submit" disabled={busy || !hasApiKey}>
              {saveMutation.isPending ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
              {status?.configured ? 'Replace' : 'Save'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Only Gemini keys are supported. You can revoke access separately in Google AI Studio.
          </p>
        </form>

        <div className="rounded-lg border border-border/70 p-3">
          <div className="mb-2 text-sm font-medium">Generation source</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {([
              ['platform', 'Platform credits', 'Use the operator-managed Gemini project.'],
              ['workspace', 'Your Gemini key', 'Use the encrypted key saved to your account.'],
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
            Active: <span className="font-medium text-foreground">{activeSource === 'workspace' ? 'Your Gemini key' : 'Platform credits'}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {status?.configured ? (
            <span aria-label="Stored key masked">Stored key: <span className="font-mono tracking-[0.16em] text-foreground">••••••••••••••••</span></span>
          ) : null}
          <span>Validated: {formatDate(status?.validatedAt)}</span>
          <span>Updated: {formatDate(status?.updatedAt)}</span>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => void testConnection()} disabled={busy || !status?.configured}>
            {testMutation.isPending ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="mr-2 size-4" aria-hidden="true" />}
            Test connection
          </Button>
          <Button type="button" variant="ghost" onClick={requestDeleteConnection} disabled={busy || !status?.configured}>
            <Trash2 className="mr-2 size-4" aria-hidden="true" />
            Delete key
          </Button>
        </div>

        {statusQuery.isLoading ? <p className="text-sm text-muted-foreground">Loading Gemini connection…</p> : null}
        {error ? <p role="alert" className="text-sm text-destructive">{mutationMessage(error, 'Gemini connection request failed.')}</p> : null}
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
            <AlertDialogTitle>Delete your Gemini key?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the encrypted key from your account. It does not revoke the key at Google AI Studio.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteConfirmError ? (
            <p role="alert" className="text-sm text-destructive">
              {deleteConfirmError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteConfirmPending}>Keep key</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteConfirmPending}
              onClick={() => void deleteConnection()}
            >
              {deleteConfirmPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
              ) : null}
              Delete key
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
