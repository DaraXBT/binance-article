'use client';

import { useLanguage } from '@/components/language-provider';
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
  { id: 'professional' },
  { id: 'creative' },
  { id: 'educational' },
  { id: 'minimal' },
  { id: 'storytelling' },
];

export function SettingsStep({ formData, onUpdate }: SettingsStepProps) {
  const { messages } = useLanguage();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold mb-4">{messages.settingsStep.title}</h2>
        <p className="text-muted-foreground mb-6">
          {messages.settingsStep.subtitle}
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <Label htmlFor="targetAudience" className="mb-2 block">
            {messages.settingsStep.targetAudience}
          </Label>
          <Input
            id="targetAudience"
            placeholder={messages.settingsStep.targetAudiencePlaceholder}
            value={formData.targetAudience}
            onChange={(e) => onUpdate({ targetAudience: e.target.value })}
          />
          <p className="text-xs text-muted-foreground mt-1">
            {messages.settingsStep.targetAudienceHint}
          </p>
        </div>

        <div>
          <Label htmlFor="style" className="mb-2 block">
            {messages.settingsStep.presentationStyle}
          </Label>
          <Select value={formData.style} onValueChange={(value) => onUpdate({ style: value })}>
            <SelectTrigger id="style">
              <SelectValue placeholder={messages.settingsStep.selectStyle} />
            </SelectTrigger>
            <SelectContent>
              {PRESENTATION_STYLES.map((style) => (
                <SelectItem key={style.id} value={style.id}>
                  <div>
                    <div className="font-medium">
                      {messages.settingsStep.styleOptions[
                        style.id as keyof typeof messages.settingsStep.styleOptions
                      ].label}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {messages.settingsStep.styleOptions[
                        style.id as keyof typeof messages.settingsStep.styleOptions
                      ].description}
                    </div>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1">
            {messages.settingsStep.styleHint}
          </p>
        </div>

        <div>
          <Label htmlFor="additionalNotes" className="mb-2 block">
            {messages.settingsStep.additionalNotes}
          </Label>
          <Textarea
            id="additionalNotes"
            placeholder={messages.settingsStep.additionalNotesPlaceholder}
            value={formData.additionalNotes}
            onChange={(e) => onUpdate({ additionalNotes: e.target.value })}
            rows={4}
          />
          <p className="text-xs text-muted-foreground mt-1">
            {messages.settingsStep.additionalNotesHint}
          </p>
        </div>
      </div>
    </div>
  );
}
