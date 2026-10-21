'use client';

import { useEffect, useState } from 'react';
import { Laptop, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';

import { useLanguage } from '@/components/language-provider';
import { SettingsGroup } from '@/components/settings/settings-primitives';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AccountSettingsCopy } from '@/lib/account-settings-i18n';
import { isLanguage, LANGUAGES } from '@/lib/i18n';
import { cn } from '@/lib/utils';

type ThemeChoice = 'light' | 'dark' | 'system';

export function GeneralSettingsSection({ copy }: { copy: AccountSettingsCopy }) {
  const { language, messages, setLanguage } = useLanguage();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const themeOptions: { value: ThemeChoice; label: string; Icon: typeof Sun }[] = [
    { value: 'light', label: messages?.theme?.light ?? 'Light', Icon: Sun },
    { value: 'dark', label: messages?.theme?.dark ?? 'Dark', Icon: Moon },
    { value: 'system', label: messages?.theme?.system ?? 'System', Icon: Laptop },
  ];
  // next-themes only knows the stored choice after hydration.
  const selectedTheme = mounted ? (theme ?? 'system') : null;

  return (
    <div className="space-y-6" data-settings-general>
      <SettingsGroup
        title={copy.t('appearance')}
        titleId="settings-appearance-title"
        description={copy.t('appearanceDescription')}
      >
        <div
          role="radiogroup"
          aria-labelledby="settings-appearance-title"
          className="grid max-w-md grid-cols-3 gap-2"
        >
          {themeOptions.map(({ value, label, Icon }) => {
            const checked = selectedTheme === value;
            return (
              <label
                key={value}
                className={cn(
                  'flex min-h-11 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border px-2 py-3 text-center text-sm font-medium transition-colors',
                  'has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
                  checked
                    ? 'border-primary bg-primary/5 text-foreground'
                    : 'border-border/70 text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                )}
              >
                <input
                  type="radio"
                  name="settings-theme"
                  value={value}
                  checked={checked}
                  onChange={() => setTheme(value)}
                  className="sr-only"
                />
                <Icon aria-hidden="true" className="size-5" />
                <span className="max-w-full break-words">{label}</span>
              </label>
            );
          })}
        </div>
      </SettingsGroup>

      <SettingsGroup
        title={copy.t('languageLabel')}
        titleId="settings-language-title"
        description={copy.t('languageDescription')}
      >
        <Select
          value={language}
          onValueChange={(value) => {
            if (isLanguage(value)) setLanguage(value);
          }}
        >
          <SelectTrigger
            id="settings-language"
            aria-labelledby="settings-language-title"
            className="h-10 w-full rounded-lg sm:w-72"
            data-settings-language-trigger
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="rounded-lg">
            {LANGUAGES.map((candidate) => (
              <SelectItem
                key={candidate.code}
                value={candidate.code}
                data-settings-language-option={candidate.code}
              >
                <span lang={candidate.code}>{candidate.nativeName}</span>
                {candidate.name !== candidate.nativeName ? (
                  <span className="text-muted-foreground">{candidate.name}</span>
                ) : null}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsGroup>
    </div>
  );
}
