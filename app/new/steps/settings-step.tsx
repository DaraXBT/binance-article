'use client';

import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface SettingsStepProps {
  formData: {
    targetAudience: string;
    style: string;
    additionalNotes: string;
  };
  onUpdate: (updates: any) => void;
}

const PRESENTATION_STYLES = [
  { id: 'professional', label: 'Professional', description: 'Corporate/Business' },
  { id: 'creative', label: 'Creative', description: 'Dynamic/Artistic' },
  { id: 'educational', label: 'Educational', description: 'Academic/Learning' },
  { id: 'minimal', label: 'Minimal', description: 'Clean/Simple' },
  { id: 'storytelling', label: 'Storytelling', description: 'Narrative-driven' },
];

export function SettingsStep({ formData, onUpdate }: SettingsStepProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold mb-4">Configure Your Deck</h2>
        <p className="text-muted-foreground mb-6">
          Provide additional details to customize your presentation
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <Label htmlFor="targetAudience" className="mb-2 block">
            Target Audience
          </Label>
          <Input
            id="targetAudience"
            placeholder="e.g., Executives, Students, General Public"
            value={formData.targetAudience}
            onChange={(e) => onUpdate({ targetAudience: e.target.value })}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Who is your primary audience?
          </p>
        </div>

        <div>
          <Label htmlFor="style" className="mb-2 block">
            Presentation Style
          </Label>
          <Select value={formData.style} onValueChange={(value) => onUpdate({ style: value })}>
            <SelectTrigger id="style">
              <SelectValue placeholder="Select a style" />
            </SelectTrigger>
            <SelectContent>
              {PRESENTATION_STYLES.map((style) => (
                <SelectItem key={style.id} value={style.id}>
                  <div>
                    <div className="font-medium">{style.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {style.description}
                    </div>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1">
            Choose a style that matches your topic
          </p>
        </div>

        <div>
          <Label htmlFor="additionalNotes" className="mb-2 block">
            Additional Notes (Optional)
          </Label>
          <Textarea
            id="additionalNotes"
            placeholder="Any specific requirements, key points, or special instructions..."
            value={formData.additionalNotes}
            onChange={(e) => onUpdate({ additionalNotes: e.target.value })}
            rows={4}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Help us generate content that better fits your needs
          </p>
        </div>
      </div>
    </div>
  );
}
