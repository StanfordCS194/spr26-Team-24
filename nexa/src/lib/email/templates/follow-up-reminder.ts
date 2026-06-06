import { ISSUE_TYPE_LABELS } from "@/lib/constants";
import { formatFullDateTime } from "@/lib/utils";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatIssueType(issueType: string | null): string {
  if (!issueType) return "an infrastructure issue";
  return ISSUE_TYPE_LABELS[issueType] ?? issueType;
}

export function followUpReminderTemplate(params: {
  name: string;
  reportId: string;
  issueType: string | null;
  address: string | null;
  createdAt: Date;
  updatedAt: Date;
  externalTrackingId: string | null;
  summary: string | null;
}) {
  const {
    name,
    reportId,
    issueType,
    address,
    createdAt,
    updatedAt,
    externalTrackingId,
    summary,
  } = params;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const displayName = escapeHtml(name || "there");
  const issueLabelText = formatIssueType(issueType);
  const issueLabel = escapeHtml(issueLabelText);
  const safeAddress = address ? escapeHtml(address) : null;
  const safeSummary = summary ? escapeHtml(summary) : null;
  const safeTrackingId = externalTrackingId
    ? escapeHtml(externalTrackingId)
    : null;
  const submittedDate = escapeHtml(formatFullDateTime(createdAt));
  const lastUpdatedDate = escapeHtml(formatFullDateTime(updatedAt));

  return {
    subject: `Follow-up recommended for your ${issueLabelText} report`,
    html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Follow-up Reminder</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">
          <tr>
            <td style="background-color:#18181b;padding:32px 40px;">
              <p style="margin:0;font-size:24px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">Nexa</p>
            </td>
          </tr>

          <tr>
            <td style="padding:32px 40px 0;">
              <span style="display:inline-block;background-color:#f59e0b;color:#ffffff;font-size:13px;font-weight:600;padding:4px 12px;border-radius:999px;letter-spacing:0.3px;">
                FOLLOW-UP RECOMMENDED
              </span>
            </td>
          </tr>

          <tr>
            <td style="padding:20px 40px 40px;">
              <h1 style="margin:0 0 12px;font-size:22px;font-weight:600;color:#18181b;">Check in on your report, ${displayName}</h1>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#3f3f46;">
                You submitted a report about ${issueLabel} on ${submittedDate}. We have not seen a recent update in Nexa, so you may want to check whether the issue has been resolved or follow up with the relevant office.
              </p>
              <p style="margin:0 0 24px;font-size:13px;line-height:1.6;color:#71717a;">
                This reminder reflects app-side tracking only. It is not official confirmation from a municipality and does not mean the city has acknowledged, started, or completed work.
              </p>

              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9fb;border:1px solid #e4e4e7;border-radius:6px;margin-bottom:28px;">
                <tr>
                  <td style="padding:20px 24px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:6px 0;font-size:13px;color:#71717a;width:140px;">Reference</td>
                        <td style="padding:6px 0;font-size:13px;color:#18181b;font-family:monospace;">${escapeHtml(reportId)}</td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0;font-size:13px;color:#71717a;">Issue type</td>
                        <td style="padding:6px 0;font-size:13px;color:#18181b;font-weight:500;">${issueLabel}</td>
                      </tr>
                      ${
                        safeAddress
                          ? `
                      <tr>
                        <td style="padding:6px 0;font-size:13px;color:#71717a;">Location</td>
                        <td style="padding:6px 0;font-size:13px;color:#18181b;">${safeAddress}</td>
                      </tr>`
                          : ""
                      }
                      <tr>
                        <td style="padding:6px 0;font-size:13px;color:#71717a;">Submitted</td>
                        <td style="padding:6px 0;font-size:13px;color:#18181b;">${submittedDate}</td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0;font-size:13px;color:#71717a;">Last app update</td>
                        <td style="padding:6px 0;font-size:13px;color:#18181b;">${lastUpdatedDate}</td>
                      </tr>
                      ${
                        safeTrackingId
                          ? `
                      <tr>
                        <td style="padding:6px 0;font-size:13px;color:#71717a;">Tracking ID</td>
                        <td style="padding:6px 0;font-size:13px;color:#18181b;">${safeTrackingId}</td>
                      </tr>`
                          : ""
                      }
                      ${
                        safeSummary
                          ? `
                      <tr>
                        <td style="padding:6px 0;font-size:13px;color:#71717a;">Summary</td>
                        <td style="padding:6px 0;font-size:13px;color:#18181b;">${safeSummary}</td>
                      </tr>`
                          : ""
                      }
                    </table>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 28px;font-size:15px;line-height:1.6;color:#3f3f46;">
                Suggested follow-up: ask the relevant office whether this report is still open and, if it has been fixed, mark it resolved in Nexa.
              </p>

              <a href="${appUrl}/dashboard"
                style="display:inline-block;background-color:#18181b;color:#ffffff;text-decoration:none;font-size:15px;font-weight:500;padding:12px 24px;border-radius:6px;">
                View your reports
              </a>
            </td>
          </tr>

          <tr>
            <td style="padding:24px 40px;border-top:1px solid #e4e4e7;">
              <p style="margin:0;font-size:13px;color:#71717a;">
                You're receiving this because you submitted a report on
                <a href="${appUrl}" style="color:#71717a;">Nexa</a>.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
  };
}
