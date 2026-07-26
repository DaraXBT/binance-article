'use client';

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';

import {
  LANGUAGE_COOKIE_NAME,
  LEGACY_LANGUAGE_COOKIE_NAME,
  translations,
  UI_LANGUAGE,
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
}: {
  children: ReactNode;
  initialLanguage?: Language;
}) {
  const language = UI_LANGUAGE;
  const setLanguage = useCallback((_nextLanguage: Language) => {
    // Kept as a no-op for context/API compatibility. The product chrome is
    // intentionally English-only; article content may still carry its own
    // source language.
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, UI_LANGUAGE);
      window.localStorage.removeItem(LEGACY_LANGUAGE_COOKIE_NAME);
    } catch {
      // The fixed English UI does not depend on browser storage availability.
    }
    try {
      document.cookie = `${LANGUAGE_COOKIE_NAME}=${UI_LANGUAGE}; path=/; max-age=${60 * 60 * 24 * 365}`;
      document.cookie = `${LEGACY_LANGUAGE_COOKIE_NAME}=; path=/; max-age=0`;
    } catch {
      // Hardened cookie settings cannot change the in-memory English locale.
    }
    document.documentElement.lang = UI_LANGUAGE;
  }, []);

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      messages: translations[UI_LANGUAGE],
    }),
    [language, setLanguage],
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
