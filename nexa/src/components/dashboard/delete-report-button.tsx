"use client";

import Link from "next/link";
import type React from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { useI18n } from "@/i18n/provider";
import type { MessageKey } from "@/i18n/messages";
import type { ApiResponse } from "@/lib/api/response";

interface DeleteReportButtonProps {
  reportId: string;
  redirectTo?: string;
  showEdit?: boolean;
  deleteLabel?: string;
  deleteLabelKey?: MessageKey;
  deleteClassName?: string;
}

export function DeleteReportButton({
  reportId,
  redirectTo,
  showEdit = true,
  deleteLabel,
  deleteLabelKey = "common.delete",
  deleteClassName,
}: DeleteReportButtonProps) {
  const router = useRouter();
  const { t } = useI18n();
  const [deleting, setDeleting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolvedDeleteLabel = deleteLabel ? deleteLabel : t(deleteLabelKey);

  const handleDelete = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();

    if (!confirming) {
      setConfirming(true);
      return;
    }

    setDeleting(true);
    setError(null);

    try {
      const response = await fetch(`/api/reports/${reportId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const payload = (await response
          .json()
          .catch(() => null)) as ApiResponse<unknown> | null;
        throw new Error(
          payload && !payload.success
            ? payload.error
            : t("common.somethingWrong"),
        );
      }

      if (redirectTo) {
        router.push(redirectTo);
      } else {
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.somethingWrong"));
      setConfirming(false);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      className="flex flex-col items-end gap-1"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2">
        {confirming && !deleting && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setConfirming(false);
            }}
            className="font-mono text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground"
          >
            {t("common.cancel")}
          </button>
        )}
        {showEdit && !confirming && (
          <Link
            href={`/dashboard/reports/${reportId}/edit`}
            onClick={(event) => event.stopPropagation()}
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-xs uppercase tracking-wider text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Pencil className="size-3.5" />
            {t("common.edit")}
          </Link>
        )}
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className={
            confirming
              ? "inline-flex items-center gap-1.5 rounded-full bg-red-600 px-2.5 py-1 font-mono text-xs uppercase tracking-wider text-white transition-colors hover:bg-red-700 disabled:opacity-60"
              : (deleteClassName ??
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-xs uppercase tracking-wider text-muted-foreground transition-colors hover:bg-muted hover:text-red-600 disabled:opacity-60")
          }
          aria-label={confirming ? t("common.confirm") : resolvedDeleteLabel}
        >
          {deleting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Trash2 className="size-3.5" />
          )}
          {confirming ? t("common.confirm") : resolvedDeleteLabel}
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
