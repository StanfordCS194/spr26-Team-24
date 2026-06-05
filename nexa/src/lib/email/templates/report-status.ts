import type { ReportStatus } from "@/generated/prisma/enums";

const STATUS_COPY: Record<
  ReportStatus,
  { label: string; description: string; color: string } | null
> = {
  DRAFT: null,
  CLASSIFYING: null,
  CONFIRMED: null,
  SUBMITTING: null,
  SUBMITTED: {
    label: "Submitted to agency",
    description:
      "Your report has been forwarded to the responsible agency for review.",
    color: "#3b82f6",
  },
  ACKNOWLEDGED: {
    label: "Acknowledged",
    description:
      "The agency has acknowledged your report and it's in their queue.",
    color: "#8b5cf6",
  },
  IN_PROGRESS: {
    label: "In progress",
    description: "Work on your reported issue has started.",
    color: "#f59e0b",
  },
  RESOLVED: {
    label: "Resolved",
    description:
      "The issue you reported has been resolved. Thanks for helping improve your city.",
    color: "#10b981",
  },
  CLOSED: {
    label: "Closed",
    description: "This report has been closed.",
    color: "#6b7280",
  },
};

export function reportStatusTemplate(params: {
  name: string;
  reportId: string;
  status: ReportStatus;
  address: string | null;
}) {
  const { name, reportId, status, address } = params;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const displayName = name || "there";
  const copy = STATUS_COPY[status];

  if (!copy) return null;

  return {
    subject: `Your report is now: ${copy.label}`,
    html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Report Update</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="background-color:#18181b;padding:32px 40px;">
              <p style="margin:0;font-size:24px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">Nexa</p>
            </td>
          </tr>

          <!-- Status badge -->
          <tr>
            <td style="padding:32px 40px 0;">
              <span style="display:inline-block;background-color:${copy.color};color:#ffffff;font-size:13px;font-weight:600;padding:4px 12px;border-radius:999px;letter-spacing:0.3px;">
                ${copy.label.toUpperCase()}
              </span>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:20px 40px 40px;">
              <h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#18181b;">Update on your report, ${displayName}</h1>
              <p style="margin:0 0 24px;font-size:13px;color:#71717a;">Reference: <code style="font-family:monospace;font-size:13px;background:#f4f4f5;padding:2px 6px;border-radius:4px;">${reportId}</code></p>

              ${address ? `<p style="margin:0 0 8px;font-size:13px;color:#71717a;">Location: ${address}</p>` : ""}

              <p style="margin:0 0 32px;font-size:15px;line-height:1.6;color:#3f3f46;">
                ${copy.description}
              </p>

              <a href="${appUrl}/dashboard"
                style="display:inline-block;background-color:#18181b;color:#ffffff;text-decoration:none;font-size:15px;font-weight:500;padding:12px 24px;border-radius:6px;">
                View report
              </a>
            </td>
          </tr>

          <!-- Footer -->
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
