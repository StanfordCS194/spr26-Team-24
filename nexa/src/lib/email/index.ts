import type { IssueType, ReportStatus } from "@/generated/prisma/enums";
import { welcomeTemplate } from "./templates/welcome";
import { reportConfirmationTemplate } from "./templates/report-confirmation";
import { reportStatusTemplate } from "./templates/report-status";

const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";

const SENDER = {
  name: "Nexa",
  email: process.env.BREVO_SENDER_EMAIL ?? "noreply@nexa.app",
};

interface BrevoPayload {
  sender: { name: string; email: string };
  to: { email: string; name?: string }[];
  subject: string;
  htmlContent: string;
}

async function sendEmail(to: { email: string; name?: string }, subject: string, html: string) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.warn("[email] BREVO_API_KEY not set — skipping email send");
    return;
  }

  const payload: BrevoPayload = {
    sender: SENDER,
    to: [to],
    subject,
    htmlContent: html,
  };

  const res = await fetch(BREVO_API_URL, {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Brevo API error ${res.status}: ${body}`);
  }
}

export async function sendWelcomeEmail(user: { email: string; name: string | null }) {
  const { subject, html } = welcomeTemplate(user.name ?? "");
  await sendEmail({ email: user.email, name: user.name ?? undefined }, subject, html);
}

export async function sendReportConfirmationEmail(
  user: { email: string; name: string | null },
  report: {
    id: string;
    issueType: IssueType | null;
    address: string | null;
    agency: { name: string } | null;
  },
) {
  const template = reportConfirmationTemplate({
    name: user.name ?? "",
    reportId: report.id,
    issueType: report.issueType,
    address: report.address,
    agencyName: report.agency?.name ?? null,
  });
  await sendEmail({ email: user.email, name: user.name ?? undefined }, template.subject, template.html);
}

export async function sendReportStatusEmail(
  user: { email: string; name: string | null },
  report: { id: string; status: ReportStatus; address: string | null },
) {
  const template = reportStatusTemplate({
    name: user.name ?? "",
    reportId: report.id,
    status: report.status,
    address: report.address,
  });

  if (!template) return;

  await sendEmail({ email: user.email, name: user.name ?? undefined }, template.subject, template.html);
}
