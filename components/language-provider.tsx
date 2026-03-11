'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  isLanguage,
  LANGUAGE_COOKIE_NAME,
  translations,
  type Language,
} from '@/lib/i18n';

const STORAGE_KEY = LANGUAGE_COOKIE_NAME;

type LanguageContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  messages: typeof translations.en;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({
  children,
  initialLanguage = 'km',
}: {
  children: ReactNode;
  initialLanguage?: Language;
}) {
  const [language, setLanguage] = useState<Language>(() => {
    if (typeof window === 'undefined') {
      return initialLanguage;
    }

    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isLanguage(stored) ? stored : initialLanguage;
  });

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, language);
    document.cookie = `${LANGUAGE_COOKIE_NAME}=${language}; path=/; max-age=${60 * 60 * 24 * 365}`;
    document.documentElement.lang = language;
  }, [language]);

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      messages: translations[language],
    }),
    [language],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }

  return context;
}
