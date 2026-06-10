import { NextResponse } from "next/server";

/**
 * The single response contract every API route shares. Clients branch on the
 * `success` discriminant instead of hand-rolling per-endpoint unmarshalling:
 * a success carries its payload in `data`, a failure carries a human-readable
 * `error` plus an optional machine-readable `code`.
 */
export type ApiResponse<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: string;
      code?: string;
      details?: Record<string, unknown>;
    };

/**
 * Build a success envelope wrapping `data`. Raw entities (e.g. a Prisma row)
 * go straight into `data` so the shape stays uniform across every route.
 */
export function successResponse<T>(
  data: T,
  status = 200,
): NextResponse<ApiResponse<T>> {
  return NextResponse.json({ success: true, data }, { status });
}

/**
 * Build an error envelope. `status` is required so each route states its HTTP
 * status explicitly; `code` is an optional stable identifier for clients that
 * want to branch on a reason rather than the localized message; `details`
 * carries optional structured context (e.g. the `duplicateOf` report id) for
 * clients that need to act on the failure.
 */
export function errorResponse(
  message: string,
  status: number,
  code?: string,
  details?: Record<string, unknown>,
): NextResponse<ApiResponse<never>> {
  return NextResponse.json(
    {
      success: false,
      error: message,
      ...(code ? { code } : {}),
      ...(details ? { details } : {}),
    },
    { status },
  );
}
