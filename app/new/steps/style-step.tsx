'use client';

import { useLanguage } from '@/components/language-provider';
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
  const { messages } = useLanguage();

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold mb-2">{messages.newDeck.style.title}</h2>
        <p className="text-muted-foreground mb-6">
          {messages.newDeck.style.subtitle}
        </p>
      </div>

      <div className="space-y-3">
        <Label className="text-sm font-medium">{messages.newDeck.style.illustrationStyle}</Label>
        <div className="grid gap-4">
          {ILLUSTRATION_STYLES.map((style) => {
            const isSelected = formData.illustrationStyle === style.id;
            return (
              <button
                key={style.id}
                onClick={() => onUpdate({ illustrationStyle: style.id })}
                className={`relative rounded-xl border border-dotted p-4 text-left transition-colors duration-150 ${
                  isSelected
                    ? 'border-primary/65 bg-primary/[0.04]'
                    : 'border-border hover:border-primary/40 hover:bg-accent/5'
                }`}
              >
                <div className="flex items-start gap-4">
                  <div className="text-3xl flex-shrink-0 mt-0.5">{style.icon}</div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-base">{style.name}</h3>
                    </div>
                    <p className="text-sm text-muted-foreground mb-3">
                      {style.description}
                    </p>

                    <div className="flex items-center gap-2">
                      {style.colors.map((color, i) => (
                        <div
                          key={i}
                          className="size-5 border border-dotted border-border/50"
                          style={{ backgroundColor: color }}
                          title={color}
                        />
                      ))}
                      <span className="text-xs text-muted-foreground ml-2">
                        {style.bestFor}
                      </span>
                    </div>
                  </div>

                  {isSelected && (
                    <div className="absolute right-3 top-3 rounded-md border border-primary/60 bg-primary px-1.5 py-1 text-primary-foreground">
                      <Check className="size-3.5" />
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">{messages.newDeck.style.numberOfSlides}</Label>
          <span className="text-2xl font-bold text-primary">{formData.slideCount}</span>
        </div>
        <Slider
          value={[formData.slideCount]}
          onValueChange={([value]) => onUpdate({ slideCount: value })}
          min={1}
          max={15}
          step={1}
          className="w-full"
        />
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{messages.newDeck.style.quick}</span>
          <span>{messages.newDeck.style.detailed}</span>
        </div>
      </div>
    </div>
  );
}
