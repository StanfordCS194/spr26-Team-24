"use client";

import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Loader2 } from "lucide-react";
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

interface SubmissionAssistantProps {
  reportId: string;
}

export function SubmissionAssistant({ reportId }: SubmissionAssistantProps) {
  const [data, setData] = useState<SubmissionFieldsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/reports/${reportId}/submission-fields`);
        const payload = res.ok
          ? ((await res.json()) as ApiResponse<SubmissionFieldsResponse>)
          : null;
        if (!cancelled) {
          setData(payload && payload.success ? payload.data : null);
        }
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [reportId]);

  const handleCopy = async (key: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 2000);
  };

  if (loading) {
    return (
      <div className="ep-card flex w-full max-w-md items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Preparing your filing details…
      </div>
    );
  }

  if (!data?.agency || data.fields.length === 0) {
    return null;
  }

  return (
    <div className="ep-card w-full max-w-md p-6 text-left">
      <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
        File with {data.agency.name}
      </span>
      <p className="mt-2 text-sm text-muted-foreground">
        Nexa doesn&apos;t submit for you. Open the official form and copy each
        value below into the matching field.
      </p>

      {data.formUrl && (
        <a
          href={data.formUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-sm text-ep-purple underline-offset-4 hover:underline"
        >
          Open {data.agency.name} form
          <ExternalLink className="size-3.5" />
        </a>
      )}

      <div className="mt-5 flex flex-col gap-4">
        {data.fields.map((field) => (
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
