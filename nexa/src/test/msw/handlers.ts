import { http, HttpResponse, type RequestHandler } from "msw";

// Default request handlers shared by every test. Keep this empty by default so
// each test declares exactly the network it expects via `server.use(...)`;
// `onUnhandledRequest: "error"` (see vitest.setup.tsx) then fails any call we
// forgot to stub, keeping tests honest.
export const handlers: RequestHandler[] = [];

/**
 * Convenience builder for a one-off JSON GET handler inside a test:
 *
 *   server.use(jsonGet("https://api.example.com/x", { ok: true }));
 */
export function jsonGet(url: string, body: unknown, status = 200) {
  return http.get(url, () => HttpResponse.json(body as object, { status }));
}

/**
 * Convenience builder for a one-off JSON POST handler inside a test.
 */
export function jsonPost(url: string, body: unknown, status = 200) {
  return http.post(url, () => HttpResponse.json(body as object, { status }));
}

export { http, HttpResponse };
