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

const STORAGE_KEY = LANGUAGE_COOKIE_NAME;

type LanguageContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  messages: typeof translations.en;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({
  children,
  initialLanguage,
}: {
  children: ReactNode;
  initialLanguage?: Language;
}) {
  const [language, setLanguageState] = useState<Language>(initialLanguage ?? UI_LANGUAGE);
  const setLanguage = useCallback((nextLanguage: Language) => {
    setLanguageState(nextLanguage);
  }, []);

  useEffect(() => {
    try {
      const storedLanguage = window.localStorage.getItem(STORAGE_KEY);
      if (!initialLanguage && isLanguage(storedLanguage)) {
        setLanguageState(storedLanguage);
      }
      window.localStorage.removeItem(LEGACY_LANGUAGE_COOKIE_NAME);
    } catch {
      // The selected language remains available for the current session.
    }
  }, [initialLanguage]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, language);
    } catch {
      // The selected language remains available for the current session.
    }
    try {
      document.cookie = `${LANGUAGE_COOKIE_NAME}=${language}; path=/; max-age=${60 * 60 * 24 * 365}`;
      document.cookie = `${LEGACY_LANGUAGE_COOKIE_NAME}=; path=/; max-age=0`;
    } catch {
      // Hardened cookie settings cannot change the in-memory selection.
    }
    document.documentElement.lang = language;
  }, [initialLanguage, language]);

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
