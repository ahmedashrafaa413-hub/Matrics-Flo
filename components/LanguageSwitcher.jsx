"use client";

import { useLanguage } from "../app/context/LanguageContext";

export default function LanguageSwitcher({ compact = false }) {
  const { locale, setLocale, t } = useLanguage();

  return (
    <div className={`language-switcher${compact ? " compact" : ""}`} role="group" aria-label={t("common.language")}>
      <button type="button" className={locale === "ar" ? "active" : ""} onClick={() => setLocale("ar")} aria-pressed={locale === "ar"}>
        {compact ? "AR" : t("common.arabic")}
      </button>
      <button type="button" className={locale === "en" ? "active" : ""} onClick={() => setLocale("en")} aria-pressed={locale === "en"}>
        {compact ? "EN" : t("common.english")}
      </button>
    </div>
  );
}
