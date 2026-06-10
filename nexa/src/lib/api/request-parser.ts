import { NextResponse } from "next/server";
import type { ZodType } from "zod";

/**
 * Error thrown when a request body fails schema validation. Carries the
 * human-readable validation messages so the route can surface a consistent
 * 400 response without re-deriving the failure reason.
 */
export class RequestParseError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues[0] ?? "Invalid request body.");
    this.name = "RequestParseError";
    this.issues = issues;
  }
}

/**
 * Parse an already-decoded request body against a schema, returning the typed
 * value. Throws {@link RequestParseError} when the body does not match so
 * callers get a single, consistent failure path instead of scattered inline
 * `typeof`/enum checks.
 */
export function parseRequestBody<T>(body: unknown, schema: ZodType<T>): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const path = issue.path.join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    });
    throw new RequestParseError(issues);
  }
  return result.data;
}

/**
 * Read and validate a JSON request body in one step. Returns the typed value
 * or throws {@link RequestParseError} (including when the body is not valid
 * JSON), so every route shares the same parse-and-fail behavior.
 */
export async function parseJsonRequest<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new RequestParseError(["Request body must be valid JSON."]);
  }
  return parseRequestBody(body, schema);
}

/**
 * Build the consistent 400 response returned whenever request parsing fails.
 * Keeps the error shape identical across every route in one place.
 */
export function parseErrorResponse(error: RequestParseError): NextResponse {
  return NextResponse.json({ error: error.message }, { status: 400 });
}
