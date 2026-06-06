"use client";

import { Globe2 } from "lucide-react";
import { LANGUAGES, type Locale } from "@/i18n/messages";
import { useI18n } from "@/i18n/provider";

export function LanguageSelector() {
  const { locale, setLocale, t } = useI18n();

  return (
    <label className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1.5 text-muted-foreground transition-colors hover:text-foreground">
      <Globe2 className="size-3.5" aria-hidden="true" />
      <span className="sr-only">{t("nav.language")}</span>
      <select
        aria-label={t("nav.language")}
        value={locale}
        onChange={(event) => setLocale(event.target.value as Locale)}
        className="bg-transparent font-mono text-xs font-medium uppercase tracking-wider outline-none"
      >
        {LANGUAGES.map((language) => (
          <option key={language.code} value={language.code}>
            {language.shortLabel}
          </option>
        ))}
      </select>
    </label>
  );
}
