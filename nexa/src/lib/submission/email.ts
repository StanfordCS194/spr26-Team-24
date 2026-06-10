import { Resend } from "resend";

import { IssueType } from "@/generated/prisma/enums";
import { ISSUE_TYPE_LABELS } from "@/lib/constants";
import {
  fetchWithTimeout,
  TimeoutError,
  DEFAULT_HTTP_TIMEOUT_MS,
} from "@/lib/http";

// ---------------------------------------------------------------------------
// Email submission agent (issue #31)
//
// For agencies whose `intakeMethod` is EMAIL, there is no machine API to file
// against — the accepted channel is a human-readable email to the agency's
// `intakeEmail`. This agent composes that email (report description, location,
// issue type, and the photo as an attachment when present) and sends it via
// Resend (https://resend.com).
//
// It is ENV-GATED: when `RESEND_API_KEY` is unset we never construct a client
// or hit the network. Instead we return a typed `not_configured` result so the
// orchestrator can fall back to the existing manual-assist path. The code is
// complete and activates the moment the key (and `SUBMISSION_FROM_EMAIL`) are
// set — no further changes required.
//
// This is the SUBMISSION email agent. It is distinct from `src/lib/email`,
// which sends *notification* emails to the citizen (welcome / status updates)
// via Brevo. Those two paths intentionally do not share infrastructure.
//
// Like `open311.ts`, this never throws to its caller: every outcome is a typed
// discriminated result the orchestrator maps onto a submission outcome.
// ---------------------------------------------------------------------------

/** The subset of a Report this agent needs to compose a submission email. */
export type EmailSubmittableReport = {
  id: string;
  issueType: IssueType | null;
  description: string | null;
  aiDescription: string | null;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  imageUrl: string | null;
};

/** Discriminated result of an email submission attempt — never throws. */
export type EmailSubmitResult =
  | {
      // The email was accepted by Resend. `messageId` is Resend's id for the
      // sent message, which doubles as the report's external tracking id.
      status: "submitted";
      messageId: string;
    }
  | {
      // The agent is not wired up (no RESEND_API_KEY, or no SUBMISSION_FROM_EMAIL,
      // or the agency has no intakeEmail). The caller should degrade to the
      // manual-assist path rather than treat this as a hard failure.
      status: "not_configured";
      reason: string;
    }
  | {
      // A genuine send failure (network/timeout/Resend rejected the message).
      status: "error";
      message: string;
    };

/** A composed email ready to hand to a transport. */
export type ComposedEmail = {
  subject: string;
  text: string;
  html: string;
};

// The minimal slice of the Resend client this agent uses. Narrowing to just
// `emails.send` keeps the injectable transport (for tests) small while staying
// structurally compatible with a real `Resend` instance.
type EmailSender = {
  emails: { send: Resend["emails"]["send"] };
};

function issueTypeLabel(issueType: IssueType | null): string {
  if (!issueType) return "Unspecified issue";
  return ISSUE_TYPE_LABELS[issueType] ?? issueType;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Composes the report submission email — a plain-text body for maximum agency
 * compatibility plus a simple HTML rendering. The photo, when present, is
 * attached separately (see `submitViaEmail`); the body references it so a
 * recipient knows to look for it.
 */
export function composeSubmissionEmail(
  report: EmailSubmittableReport,
  options: { agencyName: string },
): ComposedEmail {
  const label = issueTypeLabel(report.issueType);
  // Prefer the citizen's own words; fall back to the AI-generated summary.
  const description =
    report.description?.trim() || report.aiDescription?.trim() || null;

  const hasCoords =
    typeof report.latitude === "number" && typeof report.longitude === "number";
  const coords = hasCoords ? `${report.latitude}, ${report.longitude}` : null;

  const subject = `New ${label} report — ${report.address?.trim() || "location attached"}`;

  // --- Plain text -------------------------------------------------------
  const lines: string[] = [
    `A resident has submitted the following report via Nexa for ${options.agencyName}.`,
    "",
    `Issue type: ${label}`,
  ];
  if (report.address?.trim()) lines.push(`Location: ${report.address.trim()}`);
  if (coords) lines.push(`Coordinates: ${coords}`);
  lines.push("");
  lines.push("Description:");
  lines.push(description ?? "(No description provided.)");
  lines.push("");
  lines.push(
    report.imageUrl
      ? "A photo of the issue is attached to this email."
      : "No photo was provided with this report.",
  );
  lines.push("");
  lines.push(`Nexa reference: ${report.id}`);
  const text = lines.join("\n");

  // --- HTML -------------------------------------------------------------
  const htmlParts: string[] = [
    `<p>A resident has submitted the following report via Nexa for ${escapeHtml(options.agencyName)}.</p>`,
    "<ul>",
    `<li><strong>Issue type:</strong> ${escapeHtml(label)}</li>`,
  ];
  if (report.address?.trim())
    htmlParts.push(
      `<li><strong>Location:</strong> ${escapeHtml(report.address.trim())}</li>`,
    );
  if (coords)
    htmlParts.push(
      `<li><strong>Coordinates:</strong> ${escapeHtml(coords)}</li>`,
    );
  htmlParts.push("</ul>");
  htmlParts.push(
    `<p><strong>Description:</strong><br/>${escapeHtml(description ?? "(No description provided.)")}</p>`,
  );
  htmlParts.push(
    `<p>${
      report.imageUrl
        ? "A photo of the issue is attached to this email."
        : "No photo was provided with this report."
    }</p>`,
  );
  htmlParts.push(
    `<p style="color:#888;font-size:12px">Nexa reference: ${escapeHtml(report.id)}</p>`,
  );
  const html = htmlParts.join("\n");

  return { subject, text, html };
}

/**
 * Fetches the report photo and returns it as a Resend attachment, or null if
 * there is no photo or it can't be retrieved. A missing/unreachable photo must
 * never fail the submission — the email still carries the report details.
 */
async function buildPhotoAttachment(
  imageUrl: string | null,
  fetchImpl: typeof fetch,
): Promise<{ filename: string; content: Buffer } | null> {
  if (!imageUrl) return null;
  try {
    const res = await fetchImpl(imageUrl);
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    // Derive a filename from the URL path, defaulting to a generic one.
    let filename = "photo";
    try {
      const path = new URL(imageUrl).pathname;
      const last = path.split("/").filter(Boolean).pop();
      if (last) filename = last;
    } catch {
      // Non-absolute URL: keep the default filename.
    }
    if (!/\.[a-z0-9]+$/i.test(filename)) filename += ".jpg";
    return { filename, content: buffer };
  } catch {
    return null;
  }
}

/**
 * Composes and sends a report submission email to an EMAIL-intake agency.
 *
 * Never throws. Returns `not_configured` (so the orchestrator falls back to
 * manual-assist) when the Resend key, the sender address, or the agency's
 * intake email is missing. Returns `error` for a genuine send failure.
 *
 * The `resendClient` / `fetchImpl` options exist for testing — pass stubs to
 * exercise composition and dispatch without a live Resend account or network.
 */
export async function submitViaEmail(
  report: EmailSubmittableReport,
  options: {
    agencyName: string;
    intakeEmail: string | null;
    // Injected transport for tests. Production builds one from RESEND_API_KEY.
    resendClient?: EmailSender;
    fetchImpl?: typeof fetch;
  },
): Promise<EmailSubmitResult> {
  const fromEmail = process.env.SUBMISSION_FROM_EMAIL?.trim();
  const apiKey = process.env.RESEND_API_KEY?.trim();

  // Env gate: without a transport configured we never touch the network. The
  // orchestrator treats this as "fall back to manual assist", not a failure.
  const client = options.resendClient ?? (apiKey ? new Resend(apiKey) : null);
  if (!client) {
    return {
      status: "not_configured",
      reason: "RESEND_API_KEY is not set; email submission is disabled.",
    };
  }
  if (!fromEmail) {
    return {
      status: "not_configured",
      reason: "SUBMISSION_FROM_EMAIL is not set; email submission is disabled.",
    };
  }
  const to = options.intakeEmail?.trim();
  if (!to) {
    return {
      status: "not_configured",
      reason: "Agency has no intake email address.",
    };
  }

  const composed = composeSubmissionEmail(report, {
    agencyName: options.agencyName,
  });

  // A custom fetchImpl (tests) is used verbatim; otherwise fetchWithTimeout
  // bounds the photo download so a hung asset host can't stall the submission.
  const doFetch =
    options.fetchImpl ??
    ((input: RequestInfo | URL, init?: RequestInit) =>
      fetchWithTimeout(input, {
        ...init,
        timeoutMs: DEFAULT_HTTP_TIMEOUT_MS,
      }));

  const attachment = await buildPhotoAttachment(report.imageUrl, doFetch);

  try {
    const { data, error } = await client.emails.send({
      from: fromEmail,
      to,
      subject: composed.subject,
      text: composed.text,
      html: composed.html,
      ...(attachment ? { attachments: [attachment] } : {}),
    });

    if (error) {
      return {
        status: "error",
        message: error.message || "Resend rejected the submission email.",
      };
    }
    if (!data?.id) {
      return {
        status: "error",
        message: "Resend returned no message id for the submission email.",
      };
    }
    return { status: "submitted", messageId: data.id };
  } catch (err) {
    return {
      status: "error",
      message:
        err instanceof TimeoutError
          ? "Timed out sending the submission email."
          : err instanceof Error
            ? err.message
            : "Network error sending the submission email.",
    };
  }
}
