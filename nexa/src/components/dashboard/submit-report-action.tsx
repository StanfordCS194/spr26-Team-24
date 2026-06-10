"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2, Send } from "lucide-react";
import { useI18n } from "@/i18n/provider";
import type { ApiResponse } from "@/lib/api/response";

interface SubmitReportActionProps {
  reportId: string;
}

// Shape returned by POST /api/reports/[id]/submit (the orchestrator's result,
// see src/app/api/reports/[id]/submit/route.ts). Reused here rather than
// re-deriving it.
interface SubmitResponse {
  reportId: string;
  status: string;
  submitted: boolean;
  externalTrackingId?: string;
  manualAssist?: {
    intakeMethod: string;
    agencyName: string;
    intakeUrl: string | null;
    intakeEmail: string | null;
    // PHONE-intake agencies (e.g. the CARB smoking-vehicle hotline) surface a
    // hotline number here so the user can call it in. (issue #193)
    intakePhone: string | null;
  };
}

// What the orchestrator told us to do with this report, mirroring the
// SubmissionAssistant's outcome model but scoped to the dashboard card. On a
// successful automated submission we refresh the route so the server-rendered
// card re-renders with the new SUBMITTED status + tracking id, so there's no
// "submitted" state to hold here.
type State =
  | { kind: "idle" }
  | { kind: "submitting" }
  // No automated agent; point the user at the official form/email to file it.
  | {
      kind: "manual";
      agencyName: string;
      intakeUrl: string | null;
      intakeEmail: string | null;
      intakePhone: string | null;
    }
  // Submission attempt failed (network/agency error) — let the user retry.
  | { kind: "error"; message: string };

/**
 * The dashboard affordance that moves a CONFIRMED report to SUBMITTED. It POSTs
 * to the existing orchestrator endpoint (reused, not a parallel submit path)
 * and reflects its discriminated result:
 *
 *   - submitted (API/EMAIL intake): refresh the route so the card shows the new
 *     SUBMITTED status + tracking id.
 *   - manualAssist (WEB_FORM/PHONE/unconfigured email): surface the official
 *     intake link so the user can file it themselves.
 *   - error: show the reason with a retry.
 *
 * The full copy-over guide for manual filing already lives in the wizard's
 * SubmissionAssistant; here we keep the card cohesive with a compact link.
 */
export function SubmitReportAction({ reportId }: SubmitReportActionProps) {
  const router = useRouter();
  const { t } = useI18n();
  const [state, setState] = useState<State>({ kind: "idle" });

  const submit = async () => {
    setState({ kind: "submitting" });
    try {
      const res = await fetch(`/api/reports/${reportId}/submit`, {
        method: "POST",
      });
      const payload = (await res.json()) as ApiResponse<SubmitResponse>;

      if (payload.success && payload.data.submitted) {
        // The server now owns the new status + tracking id; re-render the card.
        router.refresh();
        return;
      }
      if (payload.success && payload.data.manualAssist) {
        const { agencyName, intakeUrl, intakeEmail, intakePhone } =
          payload.data.manualAssist;
        setState({
          kind: "manual",
          agencyName,
          intakeUrl,
          intakeEmail,
          intakePhone,
        });
        return;
      }
      setState({
        kind: "error",
        message:
          !payload.success && payload.error
            ? payload.error
            : t("dashboard.submitFailed"),
      });
    } catch {
      setState({ kind: "error", message: t("dashboard.submitFailed") });
    }
  };

  const submitting = state.kind === "submitting";

  if (state.kind === "manual") {
    // Prefer an online channel (form/email); fall back to the hotline number
    // for PHONE-intake agencies (e.g. CARB) as a tel: link. (issue #193)
    const href =
      state.intakeUrl ??
      (state.intakeEmail
        ? `mailto:${state.intakeEmail}`
        : state.intakePhone
          ? `tel:${state.intakePhone.replace(/[^+\d]/g, "")}`
          : null);
    const isPhone =
      !state.intakeUrl && !state.intakeEmail && !!state.intakePhone;
    return (
      <div
        className="mt-4 rounded-md border border-border bg-muted/30 px-4 py-3"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="text-sm">
          {t("dashboard.fileWith", { agency: state.agencyName })}
        </p>
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1.5 text-sm text-ep-purple underline-offset-4 hover:underline"
          >
            {isPhone
              ? `${t("dashboard.callHotline")}: ${state.intakePhone}`
              : t("dashboard.openOfficialForm")}
            <ExternalLink className="size-3.5" />
          </a>
        )}
      </div>
    );
  }

  return (
    <div
      className="mt-4 flex flex-wrap items-center gap-3"
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        onClick={submit}
        disabled={submitting}
        className="inline-flex items-center gap-1.5 rounded-full bg-ep-purple-light px-3 py-1 font-mono text-xs uppercase tracking-wider text-ep-purple transition-colors hover:bg-ep-purple hover:text-white disabled:opacity-60"
      >
        {submitting ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Send className="size-3.5" />
        )}
        {submitting ? t("dashboard.submitting") : t("dashboard.submitToAgency")}
      </button>
      {state.kind === "error" && (
        <button
          type="button"
          onClick={submit}
          className="font-mono text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground"
        >
          {t("dashboard.retrySubmit")}
        </button>
      )}
      {state.kind === "error" && (
        <p className="basis-full text-xs text-red-600" role="alert">
          {state.message}
        </p>
      )}
    </div>
  );
}
