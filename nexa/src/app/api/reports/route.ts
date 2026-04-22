import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { IssueType } from "@/generated/prisma/enums";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      description,
      aiDescription,
      issueType,
      latitude,
      longitude,
      address,
      imageUrl,
    } = body as {
      description?: string;
      aiDescription?: string;
      issueType?: string;
      latitude?: number;
      longitude?: number;
      address?: string;
      imageUrl?: string;
    };

    const validIssueType =
      issueType && Object.values(IssueType).includes(issueType as IssueType)
        ? (issueType as IssueType)
        : null;

    const report = await prisma.report.create({
      data: {
        description,
        aiDescription,
        issueType: validIssueType,
        latitude,
        longitude,
        address,
        imageUrl,
        status: "CONFIRMED",
      },
    });

    return NextResponse.json(report, { status: 201 });
  } catch (error) {
    console.error("Report creation error:", error);
    return NextResponse.json(
      { error: "Failed to create report. Please try again." },
      { status: 500 },
    );
  }
}
