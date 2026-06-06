"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useI18n } from "@/i18n/provider";

interface ResolutionPromptProps {
  reportId: string;
}

export function ResolutionPrompt({ reportId }: ResolutionPromptProps) {
  const router = useRouter();
  const { t } = useI18n();
  const [submitting, setSubmitting] = useState<"yes" | "no" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (resolved: boolean) => {
    setSubmitting(resolved ? "yes" : "no");
    setError(null);
    try {
      const response = await fetch(`/api/reports/${reportId}/resolution`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolved }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? t("common.somethingWrong"));
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.somethingWrong"));
      setSubmitting(null);
    }
  };

  return (
    <div
      className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted/30 px-4 py-3"
      onClick={(event) => event.stopPropagation()}
    >
      <p className="flex-1 text-sm">{t("dashboard.resolutionQuestion")}</p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => submit(true)}
          disabled={submitting !== null}
          className="inline-flex items-center gap-1.5 rounded-full bg-ep-green-light px-3 py-1 font-mono text-xs uppercase tracking-wider text-ep-green transition-colors hover:bg-ep-green hover:text-white disabled:opacity-60"
        >
          {submitting === "yes" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <CheckCircle2 className="size-3.5" />
          )}
          {t("dashboard.yesFixed")}
        </button>
        <button
          type="button"
          onClick={() => submit(false)}
          disabled={submitting !== null}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-xs uppercase tracking-wider text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
        >
          {submitting === "no" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <XCircle className="size-3.5" />
          )}
          {t("dashboard.notYet")}
        </button>
      </div>
      {error && (
        <p className="basis-full text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
