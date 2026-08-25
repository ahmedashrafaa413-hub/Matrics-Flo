"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  getDirection,
  normalizeLocale,
  translate
} from "../../lib/i18n";

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [locale, setLocaleState] = useState(DEFAULT_LOCALE);

  useEffect(() => {
    const stored = normalizeLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY));
    setLocaleState(stored);
  }, []);

  useEffect(() => {
    const direction = getDirection(locale);
    document.documentElement.lang = locale;
    document.documentElement.dir = direction;
    document.body.dir = direction;
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  }, [locale]);

  const setLocale = useCallback((nextLocale) => {
    setLocaleState(normalizeLocale(nextLocale));
  }, []);

  const t = useCallback((key) => translate(locale, key), [locale]);
  const value = useMemo(() => ({
    locale,
    direction: getDirection(locale),
    isArabic: locale === "ar",
    setLocale,
    t
  }), [locale, setLocale, t]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used within LanguageProvider");
  return context;
}
