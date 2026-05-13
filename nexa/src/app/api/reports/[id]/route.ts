import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function DELETE(
  _request: NextRequest,
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

    const report = await prisma.report.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });

    if (!report) {
      return NextResponse.json({ error: "Report not found." }, { status: 404 });
    }

    if (report.userId !== session.userId) {
      return NextResponse.json(
        { error: "You can only delete your own reports." },
        { status: 403 },
      );
    }

    await prisma.report.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Report deletion error:", error);
    return NextResponse.json(
      { error: "Failed to delete report. Please try again." },
      { status: 500 },
    );
  }
}
