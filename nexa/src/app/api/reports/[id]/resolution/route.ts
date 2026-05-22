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
    const body = (await request.json().catch(() => null)) as
      | { resolved?: unknown }
      | null;

    if (!body || typeof body.resolved !== "boolean") {
      return NextResponse.json(
        { error: "Field `resolved` must be a boolean." },
        { status: 400 },
      );
    }

    const report = await prisma.report.findUnique({
      where: { id },
      select: { id: true, userId: true, status: true },
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

    const nextStatus =
      body.resolved && report.status !== "CLOSED" ? "RESOLVED" : report.status;

    const updated = await prisma.report.update({
      where: { id },
      data: {
        userResolved: body.resolved,
        userResolvedAt: new Date(),
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
