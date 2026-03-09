'use client';

import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

interface ContentStepProps {
  formData: {
    title: string;
    topic: string;
    slideCount: number;
  };
  onUpdate: (updates: any) => void;
}

export function ContentStep({ formData, onUpdate }: ContentStepProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold mb-4">Define Your Presentation</h2>
        <p className="text-muted-foreground mb-6">
          Tell us about what you want to present
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <Label htmlFor="title" className="mb-2 block">
            Presentation Title
          </Label>
          <Input
            id="title"
            placeholder="e.g., Introduction to AI"
            value={formData.title}
            onChange={(e) => onUpdate({ title: e.target.value })}
          />
          <p className="text-xs text-muted-foreground mt-1">
            The main title of your presentation
          </p>
        </div>

        <div>
          <Label htmlFor="topic" className="mb-2 block">
            Topic or Subject
          </Label>
          <Textarea
            id="topic"
            placeholder="Describe the main topic or subject of your presentation..."
            value={formData.topic}
            onChange={(e) => onUpdate({ topic: e.target.value })}
            rows={4}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Provide details about what you want to cover
          </p>
        </div>

        <div>
          <Label htmlFor="slideCount" className="mb-2 block">
            Number of Slides
          </Label>
          <div className="flex items-center gap-4">
            <Input
              id="slideCount"
              type="number"
              min="3"
              max="100"
              value={formData.slideCount}
              onChange={(e) =>
                onUpdate({ slideCount: parseInt(e.target.value, 10) })
              }
              className="w-20"
            />
            <p className="text-sm text-muted-foreground">slides</p>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Recommended: 8-15 slides for a typical presentation
          </p>
        </div>
      </div>
    </div>
  );
}
