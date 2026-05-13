import { NextRequest, NextResponse } from "next/server";
import { classifyWithConsensus } from "@/lib/classify/consensus";

export async function POST(request: NextRequest) {
  try {
    const { description, imageBase64 } = await request.json();

    if (!description && !imageBase64) {
      return NextResponse.json(
        { error: "Provide a description or image." },
        { status: 400 },
      );
    }

    const result = await classifyWithConsensus(
      description ?? "",
      imageBase64 ?? null,
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error("[classify] Unexpected error:", error);
    return NextResponse.json(
      { error: "Classification failed. Please try again." },
      { status: 500 },
    );
  }
}
