'use client';

import { ILLUSTRATION_STYLES } from '@/lib/config';
import { Check } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';

interface StyleStepProps {
  formData: {
    illustrationStyle: string;
    slideCount: number;
  };
  onUpdate: (updates: any) => void;
}

export function StyleStep({ formData, onUpdate }: StyleStepProps) {
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold mb-2">Choose Style & Slides</h2>
        <p className="text-muted-foreground mb-6">
          Pick an illustration style and how many slides you want
        </p>
      </div>

      {/* Style Cards */}
      <div className="space-y-3">
        <Label className="text-sm font-medium">Illustration Style</Label>
        <div className="grid gap-4">
          {ILLUSTRATION_STYLES.map((style) => {
            const isSelected = formData.illustrationStyle === style.id;
            return (
              <button
                key={style.id}
                onClick={() => onUpdate({ illustrationStyle: style.id })}
                className={`relative text-left p-5 rounded-xl border-2 transition-all duration-200 ${
                  isSelected
                    ? 'border-primary bg-primary/5 shadow-md shadow-primary/10'
                    : 'border-border hover:border-primary/40 hover:bg-accent/5'
                }`}
              >
                <div className="flex items-start gap-4">
                  {/* Icon */}
                  <div className="text-3xl flex-shrink-0 mt-0.5">{style.icon}</div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-base">{style.name}</h3>
                    </div>
                    <p className="text-sm text-muted-foreground mb-3">
                      {style.description}
                    </p>

                    {/* Color swatches */}
                    <div className="flex items-center gap-2">
                      {style.colors.map((color, i) => (
                        <div
                          key={i}
                          className="w-5 h-5 rounded-full border border-border/50"
                          style={{ backgroundColor: color }}
                          title={color}
                        />
                      ))}
                      <span className="text-xs text-muted-foreground ml-2">
                        {style.bestFor.split(',')[0]}
                      </span>
                    </div>
                  </div>

                  {/* Selected indicator */}
                  {isSelected && (
                    <div className="absolute top-3 right-3 bg-primary text-primary-foreground rounded-full p-1">
                      <Check className="h-4 w-4" />
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Slide Count Slider */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Number of Slides</Label>
          <span className="text-2xl font-bold text-primary">{formData.slideCount}</span>
        </div>
        <Slider
          value={[formData.slideCount]}
          onValueChange={([value]) => onUpdate({ slideCount: value })}
          min={3}
          max={15}
          step={1}
          className="w-full"
        />
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>3 slides (quick)</span>
          <span>15 slides (detailed)</span>
        </div>
      </div>
    </div>
  );
}
