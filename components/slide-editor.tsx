'use client';

import { useEffect, useMemo, useState } from 'react';
import { Save, Trash2 } from 'lucide-react';

import { useLanguage } from '@/components/language-provider';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { DeckSlide, SlideUpdateRequest } from '@/lib/schemas';

interface SlideEditorProps {
  slide: DeckSlide | null;
  onSave?: (update: SlideUpdateRequest) => void;
  onDelete?: () => void;
  isSaving?: boolean;
  isDeleting?: boolean;
}

type SlideDraft = {
  title: string;
  subtitle: string;
  bulletsText: string;
  notes: string;
};

function buildDraft(slide: DeckSlide): SlideDraft {
  return {
    title: slide.title,
    subtitle: slide.subtitle ?? '',
    bulletsText: slide.bulletPoints.join('\n'),
    notes: slide.notes ?? '',
  };
}

export function SlideEditor({
  slide,
  onSave,
  onDelete,
  isSaving = false,
  isDeleting = false,
}: SlideEditorProps) {
  const { messages } = useLanguage();
  const [draft, setDraft] = useState<SlideDraft | null>(null);
  const initialDraft = useMemo(() => (slide ? buildDraft(slide) : null), [slide]);

  useEffect(() => {
    setDraft(initialDraft);
  }, [initialDraft]);

  if (!slide || !draft || !initialDraft) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p>{messages.slideEditor.selectSlide}</p>
      </div>
    );
  }

  const isDirty =
    draft.title !== initialDraft.title ||
    draft.subtitle !== initialDraft.subtitle ||
    draft.bulletsText !== initialDraft.bulletsText ||
    draft.notes !== initialDraft.notes;

  const handleFieldChange = (field: keyof SlideDraft, value: string) => {
    setDraft((current) => (current ? { ...current, [field]: value } : current));
  };

  const handleDiscard = () => {
    setDraft(initialDraft);
  };

  const handleSave = () => {
    if (!onSave) {
      return;
    }

    onSave({
      title: draft.title.trim(),
      subtitle: draft.subtitle.trim() || undefined,
      bullets: draft.bulletsText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
      notes: draft.notes.trim() || undefined,
    });
  };

  return (
    <div className="studio-slide-editor space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">
            {messages.slideEditor.editSlide(slide.order + 1)}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {isDirty
              ? messages.slideEditor.unsavedChanges
              : messages.slideEditor.allChangesSaved}
          </p>
        </div>

        {onDelete ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="destructive"
                size="sm"
                disabled={isSaving || isDeleting}
                className="gap-2 rounded-lg"
              >
                <Trash2 className="h-4 w-4" />
                {messages.common.delete}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="console-dialog">
              <AlertDialogHeader>
                <AlertDialogTitle>{messages.slideEditor.deleteTitle}</AlertDialogTitle>
                <AlertDialogDescription>
                  {messages.slideEditor.deleteDescription}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{messages.common.cancel}</AlertDialogCancel>
                <AlertDialogAction onClick={onDelete}>
                  {messages.common.delete}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </div>

      <div className="space-y-4">
        <div>
          <Label htmlFor="title" className="mb-2 block">
            {messages.slideEditor.slideTitle}
          </Label>
          <Input
            id="title"
            value={draft.title}
            onChange={(event) => handleFieldChange('title', event.target.value)}
            disabled={isSaving || isDeleting}
            className="h-10 rounded-lg border-border/70 bg-background/50"
          />
        </div>

        <div>
          <Label htmlFor="subtitle" className="mb-2 block">
            {messages.slideEditor.subtitle}
          </Label>
          <Input
            id="subtitle"
            value={draft.subtitle}
            onChange={(event) => handleFieldChange('subtitle', event.target.value)}
            disabled={isSaving || isDeleting}
            className="h-10 rounded-lg border-border/70 bg-background/50"
          />
        </div>

        <div>
          <Label htmlFor="bullets" className="mb-2 block">
            {messages.slideEditor.bulletPoints}
          </Label>
          <Textarea
            id="bullets"
            value={draft.bulletsText}
            onChange={(event) => handleFieldChange('bulletsText', event.target.value)}
            placeholder={messages.slideEditor.bulletPlaceholder}
            rows={6}
            disabled={isSaving || isDeleting}
            className="rounded-lg border-border/70 bg-background/50"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {messages.slideEditor.bulletHint}
          </p>
        </div>

        <div>
          <Label htmlFor="notes" className="mb-2 block">
            {messages.slideEditor.speakerNotes}
          </Label>
          <Textarea
            id="notes"
            value={draft.notes}
            onChange={(event) => handleFieldChange('notes', event.target.value)}
            placeholder={messages.slideEditor.speakerNotesPlaceholder}
            rows={4}
            disabled={isSaving || isDeleting}
            className="rounded-lg border-border/70 bg-background/50"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Button
          onClick={handleSave}
          size="sm"
          disabled={!isDirty || !draft.title.trim() || isSaving || isDeleting}
          className="gap-2 rounded-lg"
        >
          <Save className="h-4 w-4" />
          {isSaving ? messages.slideEditor.saving : messages.slideEditor.save}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleDiscard}
          disabled={!isDirty || isSaving || isDeleting}
          className="rounded-lg"
        >
          {messages.slideEditor.discard}
        </Button>
      </div>
    </div>
  );
}
