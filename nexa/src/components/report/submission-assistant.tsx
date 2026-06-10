"use client";

import { useEffect, useState } from "react";
import {
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  Send,
} from "lucide-react";
import type { ApiResponse } from "@/lib/api/response";

interface PrefillField {
  key: string;
  label: string;
  value: string | null;
  required: boolean;
  type: string;
  hint?: string;
}

interface SubmissionFieldsResponse {
  agency: {
    name: string;
    intakeUrl: string | null;
    intakeMethod: string;
  } | null;
  formUrl?: string | null;
  fields: PrefillField[];
}

// Shape returned by POST /api/reports/[id]/submit (see the orchestrator).
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

interface SubmissionAssistantProps {
  reportId: string;
}

// What the orchestrator told us to do with this report.
type Outcome =
  | { kind: "loading" }
  // Automated (API) submission succeeded — nothing left for the user to do.
  | { kind: "submitted"; trackingId?: string }
  // No automated agent; show the copy-over guide for the official form/email.
  | { kind: "manual" }
  // Submission attempt failed (network/agency error) — let the user retry.
  | { kind: "error"; message: string };

/**
 * After a report is confirmed, this drives its submission. It first asks the
 * orchestrator (POST /submit) to file the report with the right agent:
 *
 *   - API agencies are submitted automatically — we show a success state with
 *     the tracking id, completing the flow in-app (issue #34 acceptance: a
 *     confirmed in-coverage report submitted end-to-end without leaving the app).
 *   - WEB_FORM / EMAIL agencies have no automated agent yet, so the orchestrator
 *     returns a `manualAssist` result and we fall back to the copy-over guide:
 *     the official form/address plus each field pre-filled.
 */
export function SubmissionAssistant({ reportId }: SubmissionAssistantProps) {
  const [outcome, setOutcome] = useState<Outcome>({ kind: "loading" });
  const [fields, setFields] = useState<SubmissionFieldsResponse | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Attempt submission once on mount. The orchestrator decides — automated for
  // API intake, manual-assist otherwise — so we don't need to know the agency's
  // method up front.
  useEffect(() => {
    let cancelled = false;

    async function run() {
      let next: Outcome;
      try {
        const res = await fetch(`/api/reports/${reportId}/submit`, {
          method: "POST",
        });
        const payload = (await res.json()) as ApiResponse<SubmitResponse>;

        if (payload.success && payload.data.submitted) {
          next = {
            kind: "submitted",
            trackingId: payload.data.externalTrackingId,
          };
        } else if (payload.success) {
          // manualAssist (or anything non-submitted) -> show the copy-over guide.
          next = { kind: "manual" };
        } else if (payload.code === "already_submitted") {
          // Re-render of an already-filed report (e.g. remount) is a success.
          next = { kind: "submitted" };
        } else {
          next = { kind: "error", message: payload.error };
        }
      } catch {
        next = {
          kind: "error",
          message: "Could not reach the submission service.",
        };
      }
      if (!cancelled) setOutcome(next);
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [reportId]);

  // Lazily load the copy-over fields only when we're in the manual-assist path.
  useEffect(() => {
    if (outcome.kind !== "manual" || fields !== null) return;
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/reports/${reportId}/submission-fields`);
        const payload = res.ok
          ? ((await res.json()) as ApiResponse<SubmissionFieldsResponse>)
          : null;
        if (!cancelled) {
          setFields(payload && payload.success ? payload.data : null);
        }
      } catch {
        if (!cancelled) setFields(null);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [outcome.kind, reportId, fields]);

  const handleCopy = async (key: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 2000);
  };

  const handleRetry = () => setOutcome({ kind: "loading" });

  if (outcome.kind === "loading") {
    return (
      <div className="ep-card flex w-full max-w-md items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Filing your report…
      </div>
    );
  }

  if (outcome.kind === "submitted") {
    return (
      <div className="ep-card w-full max-w-md p-6 text-left">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="size-5 text-ep-green" />
          <span className="text-sm font-medium text-foreground">
            Filed with the agency
          </span>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Nexa submitted this report for you. You can track its status from your
          dashboard.
        </p>
        {outcome.trackingId && (
          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Tracking ID
            </span>
            <span className="font-mono text-sm">{outcome.trackingId}</span>
          </div>
        )}
      </div>
    );
  }

  if (outcome.kind === "error") {
    return (
      <div className="ep-card w-full max-w-md p-6 text-left">
        <span className="text-sm font-medium text-foreground">
          We couldn&apos;t file this report automatically
        </span>
        {outcome.message && (
          <p className="mt-2 text-sm text-muted-foreground">
            {outcome.message}
          </p>
        )}
        <button
          type="button"
          onClick={handleRetry}
          className="btn-cta btn-cta-purple mt-4 inline-flex"
        >
          <Send className="size-4" />
          Try again
        </button>
      </div>
    );
  }

  // outcome.kind === "manual": show the copy-over guide once fields load.
  if (fields === null) {
    return (
      <div className="ep-card flex w-full max-w-md items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Preparing your filing details…
      </div>
    );
  }

  if (!fields.agency || fields.fields.length === 0) {
    return null;
  }

  // PHONE-intake agencies (e.g. the CARB smoking-vehicle hotline) have no online
  // form — the user calls the number surfaced below — so the copy adapts. (#193)
  const isPhone = fields.agency.intakeMethod === "PHONE";

  return (
    <div className="ep-card w-full max-w-md p-6 text-left">
      <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
        File with {fields.agency.name}
      </span>
      <p className="mt-2 text-sm text-muted-foreground">
        {isPhone
          ? "Nexa doesn't submit for you. Call the number below and read off each value to file your report."
          : "Nexa doesn't submit for you. Open the official form and copy each value below into the matching field."}
      </p>

      {fields.formUrl && (
        <a
          href={fields.formUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-sm text-ep-purple underline-offset-4 hover:underline"
        >
          Open {fields.agency.name} form
          <ExternalLink className="size-3.5" />
        </a>
      )}

      <div className="mt-5 flex flex-col gap-4">
        {fields.fields.map((field) => (
          <div key={field.key}>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">
                {field.label}
              </span>
              {field.required && (
                <span className="rounded-full bg-red-50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-red-600">
                  required
                </span>
              )}
            </div>
            {field.value ? (
              <div className="mt-1 flex items-start gap-2">
                <p className="flex-1 wrap-break-word rounded-md bg-muted/40 px-3 py-2 text-sm text-foreground">
                  {field.value}
                </p>
                <button
                  type="button"
                  onClick={() => handleCopy(field.key, field.value as string)}
                  aria-label={`Copy ${field.label}`}
                  className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {copiedKey === field.key ? (
                    <Check className="size-4 text-ep-green" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                </button>
              </div>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">
                {field.hint ?? "You'll need to fill this in."}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
