import { redirect } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Clock3,
} from "lucide-react";
import { requireAdmin } from "@/lib/admin";
import { computeAdminAnalytics } from "@/lib/admin/analytics";
import { formatDurationSeconds, formatPercent } from "@/lib/admin/format";
import { T } from "@/components/i18n-text";

// The admin analytics dashboard (issue #219). Server Component: the admin gate
// (`requireAdmin`) and the aggregate queries run entirely on the server, so a
// non-admin never receives the data — they are redirected before any query.
// The proxy (src/proxy.ts) is a first gate; this is the authoritative one.

export default async function AdminPage() {
  const session = await requireAdmin();
  if (!session) {
    // Not an admin (or not logged in). Mirror the proxy: send home rather than
    // reveal the route. The data query below never runs.
    redirect("/");
  }

  const analytics = await computeAdminAnalytics();
  const { submission, ambiguity, timeToSubmit } = analytics;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <div>
        <span className="section-label">
          <T k="admin.label" />
        </span>
        <h1 className="mt-3 text-3xl font-normal tracking-tight">
          <T k="admin.title" />
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          <T k="admin.subtitle" />
        </p>
      </div>

      {analytics.totalReports === 0 ? (
        <div className="ep-card mt-8 p-8 text-center">
          <p className="text-lg">
            <T k="admin.empty" />
          </p>
        </div>
      ) : (
        <>
          {/* Headline metrics */}
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="ep-card p-5">
              <div className="flex items-center gap-2 text-muted-foreground">
                <ClipboardList className="size-4" />
                <p className="font-mono text-xs uppercase tracking-wider">
                  <T k="admin.totalReports" />
                </p>
              </div>
              <p className="mt-3 text-3xl font-semibold">
                {analytics.totalReports}
              </p>
            </div>

            <div className="ep-card p-5">
              <div className="flex items-center gap-2 text-muted-foreground">
                <CheckCircle2 className="size-4" />
                <p className="font-mono text-xs uppercase tracking-wider">
                  <T k="admin.successRate" />
                </p>
              </div>
              <p className="mt-3 text-3xl font-semibold text-ep-green">
                {formatPercent(submission.successRate)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                <T
                  k="admin.ofReady"
                  params={{
                    submitted: submission.submitted,
                    total: submission.total,
                  }}
                />
              </p>
            </div>

            <div className="ep-card p-5">
              <div className="flex items-center gap-2 text-muted-foreground">
                <AlertTriangle className="size-4" />
                <p className="font-mono text-xs uppercase tracking-wider">
                  <T k="admin.failureRate" />
                </p>
              </div>
              <p className="mt-3 text-3xl font-semibold">
                {formatPercent(submission.failureRate)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                <T k="admin.stuck" />: {submission.stuck}
              </p>
            </div>

            <div className="ep-card p-5">
              <div className="flex items-center gap-2 text-muted-foreground">
                <AlertTriangle className="size-4" />
                <p className="font-mono text-xs uppercase tracking-wider">
                  <T k="admin.noAgencyRate" />
                </p>
              </div>
              <p className="mt-3 text-3xl font-semibold">
                {formatPercent(ambiguity.noAgencyRate)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                <T
                  k="admin.noAgencyHint"
                  params={{
                    noAgency: ambiguity.noAgency,
                    total: ambiguity.total,
                  }}
                />
              </p>
            </div>
          </div>

          {/* Time to submit */}
          <div className="ep-card mt-8 p-5">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Clock3 className="size-4" />
              <p className="font-mono text-xs uppercase tracking-wider">
                <T k="admin.timeToSubmit" />
              </p>
            </div>
            {timeToSubmit.count === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                <T k="admin.noTimingData" />
              </p>
            ) : (
              <>
                <div className="mt-3 flex flex-wrap gap-8">
                  <div>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">
                      <T k="admin.median" />
                    </p>
                    <p className="mt-1 text-2xl font-semibold">
                      {formatDurationSeconds(timeToSubmit.medianSeconds)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">
                      <T k="admin.p90" />
                    </p>
                    <p className="mt-1 text-2xl font-semibold">
                      {formatDurationSeconds(timeToSubmit.p90Seconds)}
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  <T
                    k="admin.timeToSubmitHint"
                    params={{ count: timeToSubmit.count }}
                  />
                </p>
              </>
            )}
          </div>

          {/* Breakdowns */}
          <div className="mt-8 grid gap-4 lg:grid-cols-2">
            <BreakdownCard
              icon={<Activity className="size-4" />}
              titleKey="admin.statusDistribution"
              rows={analytics.statusDistribution.map((row) => ({
                key: row.status,
                labelKey: `status.${row.status}`,
                count: row.count,
              }))}
              total={analytics.totalReports}
            />

            <BreakdownCard
              icon={<ClipboardList className="size-4" />}
              titleKey="admin.byIssueType"
              rows={analytics.byIssueType.map((row) => ({
                key: row.issueType,
                labelKey:
                  row.issueType === "UNCATEGORIZED"
                    ? "admin.uncategorized"
                    : `issue.${row.issueType}`,
                count: row.count,
              }))}
              total={analytics.totalReports}
            />
          </div>

          <div className="mt-4">
            <BreakdownCard
              icon={<ClipboardList className="size-4" />}
              titleKey="admin.byAgency"
              rows={analytics.byAgency.map((row) => ({
                key: row.agencyId ?? "__unrouted__",
                // Agency names are free-form DB strings, not translation keys,
                // so we render them literally; only the "no agency" bucket is
                // localized.
                label: row.name === "UNROUTED" ? undefined : row.name,
                labelKey:
                  row.name === "UNROUTED" ? "admin.unrouted" : undefined,
                count: row.count,
              }))}
              total={analytics.totalReports}
            />
          </div>
        </>
      )}
    </main>
  );
}

interface BreakdownRow {
  key: string;
  /** Literal label (e.g. an agency name) — takes precedence when set. */
  label?: string;
  /** Translation key for the label, used when `label` is absent. */
  labelKey?: string;
  count: number;
}

function BreakdownCard({
  icon,
  titleKey,
  rows,
  total,
}: {
  icon: React.ReactNode;
  titleKey: string;
  rows: BreakdownRow[];
  total: number;
}) {
  return (
    <div className="ep-card p-5">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <p className="font-mono text-xs uppercase tracking-wider">
          <T k={titleKey} />
        </p>
      </div>
      <ul className="mt-4 flex flex-col gap-3">
        {rows.map((row) => {
          const fraction = total === 0 ? 0 : row.count / total;
          return (
            <li key={row.key}>
              <div className="flex items-center justify-between text-sm">
                <span>
                  {row.label !== undefined ? (
                    row.label
                  ) : (
                    <T k={row.labelKey ?? ""} />
                  )}
                </span>
                <span className="font-mono text-muted-foreground">
                  {row.count}
                  {" · "}
                  {formatPercent(fraction)}
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-ep-purple"
                  style={{ width: formatPercent(fraction) }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
