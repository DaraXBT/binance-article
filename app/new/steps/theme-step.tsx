'use client';

import { THEME_PRESETS } from '@/lib/config';
import { Button } from '@/components/ui/button';
import { Check } from 'lucide-react';

interface ThemeStepProps {
  formData: {
    theme: string;
  };
  onUpdate: (updates: any) => void;
}

export function ThemeStep({ formData, onUpdate }: ThemeStepProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold mb-4">Choose a Theme</h2>
        <p className="text-muted-foreground mb-6">
          Select a visual theme for your presentation
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {Object.entries(THEME_PRESETS).map(([themeId, theme]) => (
          <button
            key={themeId}
            onClick={() => onUpdate({ theme: themeId })}
            className={`relative border border-dotted p-4 transition-colors ${
              formData.theme === themeId
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-primary/50'
            }`}
          >
            {/* Theme preview */}
            <div className="mb-3 flex h-24 w-full items-center justify-center gap-2 border border-dotted border-border/60">
              <div
                className="size-6 border border-border/50"
                style={{
                  backgroundColor: theme.colors.primary,
                }}
              />
              <div
                className="size-6 border border-border/50"
                style={{
                  backgroundColor: theme.colors.secondary,
                }}
              />
              <div
                className="size-6 border border-border/50"
                style={{
                  backgroundColor: theme.colors.accent,
                }}
              />
            </div>

            {/* Theme name */}
            <p className="font-medium text-sm mb-1">{theme.name}</p>
            <p className="text-xs text-muted-foreground mb-3">Theme</p>

            {/* Selected indicator */}
            {formData.theme === themeId && (
              <div className="absolute right-2 top-2 border border-primary/60 bg-primary px-1.5 py-1 text-primary-foreground">
                <Check className="size-3.5" />
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
