'use client';

import { useEffect, useState } from 'react';
import { Laptop, Moon, Sun } from 'lucide-react';
import { useLanguage } from '@/components/language-provider';
import { useTheme } from 'next-themes';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ThemeToggleProps {
  /** Additional classes for embedding the toggle in a sidebar or toolbar. */
  className?: string;
  /** Render the localized action label next to the icon. */
  showLabel?: boolean;
  /** Override the visible label while keeping the same accessible action. */
  label?: string;
  /** Override the accessible name independently of the visible label. */
  ariaLabel?: string;
}

export function ThemeToggle({
  className,
  showLabel = false,
  label,
  ariaLabel,
}: ThemeToggleProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const { messages } = useLanguage();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = mounted && resolvedTheme === 'dark';
  const Icon = !mounted ? Laptop : isDark ? Moon : Sun;
  const nextThemeLabel = isDark
    ? messages.theme?.light ?? 'Light'
    : messages.theme?.dark ?? 'Dark';

  const handleToggle = () => {
    if (!mounted) return;
    setTheme(isDark ? 'light' : 'dark');
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size={showLabel ? 'sm' : 'icon'}
      className={cn(
        'rounded-lg',
        showLabel && 'justify-start px-2.5',
        className,
      )}
      aria-label={ariaLabel ?? messages.theme?.ariaLabel ?? 'Toggle theme'}
      aria-pressed={isDark}
      onClick={handleToggle}
    >
      <Icon aria-hidden="true" className="h-4 w-4" />
      {showLabel ? (
        <span className="truncate">{label ?? nextThemeLabel}</span>
      ) : null}
    </Button>
  );
}
