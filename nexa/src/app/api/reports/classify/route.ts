import { NextRequest, NextResponse } from "next/server";
import { classifyWithConsensus } from "@/lib/classify/consensus";
import type { LocationContext } from "@/lib/classify/types";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      description,
      imageBase64,
      latitude,
      longitude,
      address,
      jurisdiction,
    } = body as {
      description?: string;
      imageBase64?: string;
      latitude?: number;
      longitude?: number;
      address?: string;
      jurisdiction?: string;
    };

    if (!description && !imageBase64) {
      return NextResponse.json(
        { error: "Provide a description or image." },
        { status: 400 },
      );
    }

    const location: LocationContext | null =
      typeof latitude === "number" ||
      typeof longitude === "number" ||
      address ||
      jurisdiction
        ? {
            latitude: typeof latitude === "number" ? latitude : null,
            longitude: typeof longitude === "number" ? longitude : null,
            address: address ?? null,
            jurisdiction: jurisdiction ?? null,
          }
        : null;

    const result = await classifyWithConsensus(
      description ?? "",
      imageBase64 ?? null,
      { twoStage: true, location },
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
