'use client';

import { useLanguage } from '@/components/language-provider';
import { cn } from '@/lib/utils';

export function LanguageToggle() {
  const { language, setLanguage, messages } = useLanguage();

  return (
    <div
      className="inline-flex items-center  border border-border/70 bg-background p-1"
      aria-label={messages.language.ariaLabel}
      role="group"
    >
      <button
        type="button"
        onClick={() => setLanguage('km')}
        className={cn(
          ' px-3 py-1.5 text-sm font-medium transition-colors',
          language === 'km'
            ? 'bg-foreground text-background'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        {messages.language.khmer}
      </button>
      <button
        type="button"
        onClick={() => setLanguage('en')}
        className={cn(
          ' px-3 py-1.5 text-sm font-medium transition-colors',
          language === 'en'
            ? 'bg-foreground text-background'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        {messages.language.english}
      </button>
    </div>
  );
}
