import { NextRequest } from "next/server";
import { classifyWithConsensus } from "@/lib/classify/consensus";
import type { LocationContext } from "@/lib/classify/types";
import { ClassifyRequestSchema } from "@/lib/api/schemas";
import {
  parseJsonRequest,
  RequestParseError,
  parseErrorResponse,
} from "@/lib/api/request-parser";
import { successResponse, errorResponse } from "@/lib/api/response";

export async function POST(request: NextRequest) {
  try {
    const {
      description,
      imageBase64,
      latitude,
      longitude,
      address,
      jurisdiction,
    } = await parseJsonRequest(request, ClassifyRequestSchema);

    if (!description && !imageBase64) {
      return errorResponse("Provide a description or image.", 400);
    }

    const location: LocationContext | null =
      latitude !== undefined ||
      longitude !== undefined ||
      address ||
      jurisdiction
        ? {
            latitude: latitude ?? null,
            longitude: longitude ?? null,
            address: address ?? null,
            jurisdiction: jurisdiction ?? null,
          }
        : null;

    const result = await classifyWithConsensus(
      description ?? "",
      imageBase64 ?? null,
      { twoStage: true, location },
    );

    return successResponse(result);
  } catch (error) {
    if (error instanceof RequestParseError) {
      return parseErrorResponse(error);
    }
    console.error("[classify] Unexpected error:", error);
    return errorResponse("Classification failed. Please try again.", 500);
  }
}
