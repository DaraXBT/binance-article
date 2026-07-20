'use client';

import { useEffect, useState } from 'react';
import { Laptop, Moon, Sun } from 'lucide-react';
import { useLanguage } from '@/components/language-provider';
import { useTheme } from 'next-themes';

import { Button } from '@/components/ui/button';

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const { messages } = useLanguage();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = mounted && resolvedTheme === 'dark';
  const Icon = !mounted ? Laptop : isDark ? Moon : Sun;

  const handleToggle = () => {
    if (!mounted) return;
    setTheme(isDark ? 'light' : 'dark');
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="rounded-none border-border/70"
      aria-label={messages.theme.ariaLabel}
      aria-pressed={isDark}
      onClick={handleToggle}
    >
      <Icon aria-hidden="true" className="h-4 w-4" />
    </Button>
  );
}
