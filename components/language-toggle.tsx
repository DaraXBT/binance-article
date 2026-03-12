'use client';

import { useLanguage } from '@/components/language-provider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LANGUAGES, type Language } from '@/lib/i18n';

export function LanguageToggle() {
  const { language, setLanguage, messages } = useLanguage();

  const currentLang = LANGUAGES.find((l) => l.code === language);

  return (
    <Select value={language} onValueChange={(value) => setLanguage(value as Language)}>
      <SelectTrigger
        aria-label={messages.language.ariaLabel}
        className="w-auto min-w-[100px] gap-2"
        size="sm"
      >
        <SelectValue>
          <span className="flex items-center gap-2">
            <span>{currentLang?.flag}</span>
            <span>{currentLang?.nativeName}</span>
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {LANGUAGES.map((lang) => (
          <SelectItem key={lang.code} value={lang.code}>
            <span className="flex items-center gap-2">
              <span>{lang.flag}</span>
              <span>{lang.nativeName}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
