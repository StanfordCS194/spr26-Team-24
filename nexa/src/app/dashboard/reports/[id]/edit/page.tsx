import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Save } from "lucide-react";
import { DeleteReportButton } from "@/components/dashboard/delete-report-button";
import { T, TranslatedImage } from "@/components/i18n-text";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatFullDateTime } from "@/lib/utils";

interface EditReportPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditReportPage({ params }: EditReportPageProps) {
  const session = await getSession();
  if (!session) {
    redirect(`/login?redirect=${encodeURIComponent("/dashboard")}`);
  }

  const { id } = await params;
  const report = await prisma.report.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      imageUrl: true,
      description: true,
      aiDescription: true,
      issueType: true,
      address: true,
      status: true,
      createdAt: true,
    },
  });

  if (!report || report.userId !== session.userId) {
    notFound();
  }

  async function updateReport(formData: FormData) {
    "use server";

    const currentSession = await getSession();
    if (!currentSession) {
      redirect(`/login?redirect=${encodeURIComponent("/dashboard")}`);
    }

    await prisma.report.updateMany({
      where: { id, userId: currentSession.userId },
      data: {
        description: String(formData.get("description") ?? ""),
        address: String(formData.get("address") ?? ""),
      },
    });

    redirect("/dashboard");
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        <T k="nav.dashboard" />
      </Link>

      <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="section-label">
            <T k="dashboard.editReport" />
          </span>
          <h1 className="mt-3 text-3xl font-normal tracking-tight">
            {report.issueType ? (
              <T k={`issue.${report.issueType}`} />
            ) : (
              <T k="dashboard.uncategorized" />
            )}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            <T k={`status.${report.status}`} /> ·{" "}
            <T k="report.submittedLabel" /> {formatFullDateTime(report.createdAt)}
          </p>
        </div>
      </div>

      <div className="mt-8 grid gap-6 md:grid-cols-[220px_1fr]">
        <div className="flex min-h-44 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/30">
          {report.imageUrl ? (
            <TranslatedImage
              src={report.imageUrl}
              altKey="dashboard.submittedIssueAlt"
              width={220}
              height={220}
              unoptimized
              className="max-h-64 w-full object-contain"
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              <T k="dashboard.noPhotoSubmitted" />
            </p>
          )}
        </div>

        <form action={updateReport} className="space-y-5">
          <div>
            <label
              htmlFor="address"
              className="font-mono text-xs uppercase tracking-wider text-muted-foreground"
            >
              <T k="report.location" />
            </label>
            <Input
              id="address"
              name="address"
              defaultValue={report.address ?? ""}
              className="mt-2 h-10"
            />
          </div>

          <div>
            <label
              htmlFor="description"
              className="font-mono text-xs uppercase tracking-wider text-muted-foreground"
            >
              <T k="dashboard.submittedText" />
            </label>
            <Textarea
              id="description"
              name="description"
              defaultValue={report.description ?? ""}
              className="mt-2 min-h-36"
            />
          </div>

          {report.aiDescription && (
            <div>
              <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                <T k="dashboard.classificationSummary" />
              </p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {report.aiDescription}
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="btn-cta btn-cta-purple">
              <Save className="size-4" />
              <T k="dashboard.saveChanges" />
            </button>
            <DeleteReportButton
              reportId={report.id}
              redirectTo="/dashboard"
              showEdit={false}
              deleteLabelKey="dashboard.deleteReport"
              deleteClassName="btn-cta bg-red-50 text-red-600 hover:bg-red-100"
            />
          </div>
        </form>
      </div>
    </main>
  );
}
