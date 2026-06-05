import type { IssueType } from "@/generated/prisma/enums";

const ISSUE_LABEL: Record<IssueType, string> = {
  ROAD_DAMAGE: "Road damage",
  STREETLIGHT_OUTAGE: "Streetlight outage",
  ILLEGAL_DUMPING: "Illegal dumping",
  VEHICLE_EMISSIONS: "Vehicle emissions",
  OTHER: "Other",
};

export function reportConfirmationTemplate(params: {
  name: string;
  reportId: string;
  issueType: IssueType | null;
  address: string | null;
  agencyName: string | null;
}) {
  const { name, reportId, issueType, address, agencyName } = params;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const displayName = name || "there";
  const issueLabel = issueType
    ? ISSUE_LABEL[issueType]
    : "Infrastructure issue";
  const reportUrl = `${appUrl}/dashboard`;

  return {
    subject: `Report received — ${issueLabel}`,
    html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Report Received</title>
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

          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#18181b;">Report received, ${displayName}</h1>
              <p style="margin:0 0 32px;font-size:15px;color:#71717a;">Reference: <code style="font-family:monospace;font-size:13px;background:#f4f4f5;padding:2px 6px;border-radius:4px;">${reportId}</code></p>

              <!-- Detail card -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9fb;border:1px solid #e4e4e7;border-radius:6px;margin-bottom:32px;">
                <tr>
                  <td style="padding:20px 24px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:6px 0;font-size:13px;color:#71717a;width:140px;">Issue type</td>
                        <td style="padding:6px 0;font-size:13px;color:#18181b;font-weight:500;">${issueLabel}</td>
                      </tr>
                      ${
                        address
                          ? `
                      <tr>
                        <td style="padding:6px 0;font-size:13px;color:#71717a;">Location</td>
                        <td style="padding:6px 0;font-size:13px;color:#18181b;">${address}</td>
                      </tr>`
                          : ""
                      }
                      ${
                        agencyName
                          ? `
                      <tr>
                        <td style="padding:6px 0;font-size:13px;color:#71717a;">Forwarded to</td>
                        <td style="padding:6px 0;font-size:13px;color:#18181b;">${agencyName}</td>
                      </tr>`
                          : ""
                      }
                    </table>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 32px;font-size:15px;line-height:1.6;color:#3f3f46;">
                Your report has been submitted and routed to the responsible agency.
                You'll get another email when its status changes.
              </p>

              <a href="${reportUrl}"
                style="display:inline-block;background-color:#18181b;color:#ffffff;text-decoration:none;font-size:15px;font-weight:500;padding:12px 24px;border-radius:6px;">
                View your reports
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
