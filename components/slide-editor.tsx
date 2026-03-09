'use client';

import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Slide } from '@prisma/client';
import { Trash2 } from 'lucide-react';

interface SlideEditorProps {
  slide: Slide | null;
  onUpdate?: (slide: Slide) => void;
  onDelete?: () => void;
  isLoading?: boolean;
}

export function SlideEditor({
  slide,
  onUpdate,
  onDelete,
  isLoading = false,
}: SlideEditorProps) {
  if (!slide) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p>Select a slide to edit</p>
      </div>
    );
  }

  const handleChange = (field: string, value: any) => {
    if (onUpdate) {
      onUpdate({
        ...slide,
        [field]: value,
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Edit Slide {slide.order + 1}</h3>
        {onDelete && (
          <Button
            variant="destructive"
            size="sm"
            onClick={onDelete}
            disabled={isLoading}
            className="gap-2"
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
        )}
      </div>

      <div className="space-y-4">
        <div>
          <Label htmlFor="title" className="mb-2 block">
            Slide Title
          </Label>
          <Input
            id="title"
            value={slide.title}
            onChange={(e) => handleChange('title', e.target.value)}
            disabled={isLoading}
          />
        </div>

        <div>
          <Label htmlFor="subtitle" className="mb-2 block">
            Subtitle (Optional)
          </Label>
          <Input
            id="subtitle"
            value={slide.subtitle}
            onChange={(e) => handleChange('subtitle', e.target.value)}
            disabled={isLoading}
          />
        </div>

        <div>
          <Label htmlFor="bulletPoints" className="mb-2 block">
            Bullet Points
          </Label>
          <Textarea
            id="bulletPoints"
            value={(slide.bulletPoints as string[]).join('\n')}
            onChange={(e) =>
              handleChange(
                'bulletPoints',
                e.target.value.split('\n').filter((line) => line.trim())
              )
            }
            placeholder="Enter each bullet point on a new line"
            rows={4}
            disabled={isLoading}
          />
          <p className="text-xs text-muted-foreground mt-1">
            One bullet point per line
          </p>
        </div>

        <div>
          <Label htmlFor="notes" className="mb-2 block">
            Speaker Notes
          </Label>
          <Textarea
            id="notes"
            value={slide.notes}
            onChange={(e) => handleChange('notes', e.target.value)}
            placeholder="Add speaker notes for this slide..."
            rows={3}
            disabled={isLoading}
          />
        </div>
      </div>
    </div>
  );
}
