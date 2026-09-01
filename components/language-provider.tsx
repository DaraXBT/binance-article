'use client';

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  LANGUAGE_COOKIE_NAME,
  LEGACY_LANGUAGE_COOKIE_NAME,
  isLanguage,
  translations,
  UI_LANGUAGE,
  type Language,
} from '@/lib/i18n';
import { metadataForLanguage } from '@/lib/page-metadata';

const STORAGE_KEY = LANGUAGE_COOKIE_NAME;
const ONE_YEAR_IN_SECONDS = 60 * 60 * 24 * 365;

type LanguageContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  messages: typeof translations.en;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

function resolveInitialLanguage(initialLanguage: Language | undefined): Language {
  return isLanguage(initialLanguage) ? initialLanguage : UI_LANGUAGE;
}

function persistLanguage(language: Language) {
  try {
    window.localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // The selected language remains available for the current session.
  }

  try {
    window.localStorage.removeItem(LEGACY_LANGUAGE_COOKIE_NAME);
  } catch {
    // Storage can be disabled independently from cookies.
  }

  try {
    document.cookie = `${LANGUAGE_COOKIE_NAME}=${language}; path=/; max-age=${ONE_YEAR_IN_SECONDS}; samesite=lax`;
    document.cookie = `${LEGACY_LANGUAGE_COOKIE_NAME}=; path=/; max-age=0; samesite=lax`;
  } catch {
    // Hardened cookie settings cannot change the in-memory selection.
  }

  document.documentElement.lang = language;
  document.title = metadataForLanguage(language).title;
}

export function LanguageProvider({
  children,
  initialLanguage,
}: {
  children: ReactNode;
  initialLanguage?: Language;
}) {
  const [language, setLanguageState] = useState<Language>(() => resolveInitialLanguage(initialLanguage));

  const setLanguage = useCallback((nextLanguage: Language) => {
    if (!isLanguage(nextLanguage)) return;
    setLanguageState(nextLanguage);
    // Persist in the same interaction so a navigation immediately after a
    // selection is rendered by the server in the newly selected locale.
    persistLanguage(nextLanguage);
  }, []);

  useEffect(() => {
    // The server-provided cookie value is authoritative. Local storage only
    // mirrors it for client-side continuity and is never read to override it.
    persistLanguage(language);
  }, [language]);

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      messages: translations[language],
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
