// POST /api/auth/logout
// Ends the user's session by overwriting the cookie with an expired empty value.

import { SESSION_COOKIE } from "@/lib/auth";
import { successResponse } from "@/lib/api/response";

export async function POST() {
  const response = successResponse({ loggedOut: true });
  // Setting maxAge=0 tells the browser to delete the cookie immediately
  response.cookies.set(SESSION_COOKIE, "", { maxAge: 0, path: "/" });
  return response;
}
