import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: "Not authenticated." },
        { status: 401 },
      );
    }

    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as {
      resolved?: unknown;
    } | null;

    if (!body || typeof body.resolved !== "boolean") {
      return NextResponse.json(
        { error: "Field `resolved` must be a boolean." },
        { status: 400 },
      );
    }

    const report = await prisma.report.findUnique({
      where: { id },
      select: { id: true, userId: true, status: true, issueGroupId: true },
    });

    if (!report) {
      return NextResponse.json({ error: "Report not found." }, { status: 404 });
    }

    if (report.userId !== session.userId) {
      return NextResponse.json(
        { error: "You can only update your own reports." },
        { status: 403 },
      );
    }

    const resolvedAt = new Date();

    // Shared resolution: when a report that belongs to an IssueGroup is marked
    // resolved, the whole case resolves for every reporter linked to it. The
    // group is flagged resolved and every non-closed member report is updated to
    // match. Reports with no group keep the single-report behavior below.
    if (report.issueGroupId && body.resolved) {
      await prisma.$transaction([
        prisma.issueGroup.update({
          where: { id: report.issueGroupId },
          data: {
            status: "RESOLVED",
            resolvedAt,
            resolvedByUserId: session.userId,
          },
        }),
        prisma.report.updateMany({
          where: {
            issueGroupId: report.issueGroupId,
            status: { not: "CLOSED" },
          },
          data: {
            userResolved: true,
            userResolvedAt: resolvedAt,
            status: "RESOLVED",
          },
        }),
      ]);

      return NextResponse.json({
        id: report.id,
        userResolved: true,
        status: report.status === "CLOSED" ? "CLOSED" : "RESOLVED",
      });
    }

    const nextStatus =
      body.resolved && report.status !== "CLOSED" ? "RESOLVED" : report.status;

    const updated = await prisma.report.update({
      where: { id },
      data: {
        userResolved: body.resolved,
        userResolvedAt: resolvedAt,
        status: nextStatus,
      },
      select: { id: true, userResolved: true, status: true },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Report resolution update error:", error);
    return NextResponse.json(
      { error: "Failed to update resolution. Please try again." },
      { status: 500 },
    );
  }
}
