"use client";

import { Logo } from "@/components/logo";
import { useI18n } from "@/i18n/provider";

export function Footer() {
  const { t } = useI18n();

  return (
    <footer className="w-full border-t border-border px-6 py-10">
      <div className="mx-auto flex max-w-[1440px] flex-col items-center justify-between gap-4 sm:flex-row">
        <Logo className="text-lg" />
        <p className="text-sm text-muted-foreground">{t("home.footer")}</p>
      </div>
    </footer>
  );
}
