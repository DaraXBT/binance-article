'use client';

import { THEMES } from '@/lib/config';
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
        {THEMES.map((theme) => (
          <button
            key={theme.id}
            onClick={() => onUpdate({ theme: theme.id })}
            className={`relative p-4 rounded-lg border-2 transition-all ${
              formData.theme === theme.id
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-primary/50'
            }`}
          >
            {/* Theme preview */}
            <div className="w-full h-24 rounded-md mb-3 flex items-center justify-center gap-2">
              <div
                className="w-6 h-6 rounded"
                style={{
                  backgroundColor: `hsl(${theme.colors.primary})`,
                }}
              />
              <div
                className="w-6 h-6 rounded"
                style={{
                  backgroundColor: `hsl(${theme.colors.secondary})`,
                }}
              />
              <div
                className="w-6 h-6 rounded"
                style={{
                  backgroundColor: `hsl(${theme.colors.accent})`,
                }}
              />
            </div>

            {/* Theme name */}
            <p className="font-medium text-sm mb-1">{theme.name}</p>
            <p className="text-xs text-muted-foreground mb-3">{theme.description}</p>

            {/* Selected indicator */}
            {formData.theme === theme.id && (
              <div className="absolute top-2 right-2 bg-primary text-primary-foreground rounded-full p-1">
                <Check className="h-4 w-4" />
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
