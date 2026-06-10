import { describe, expect, it } from "vitest";

import { SESSION_COOKIE } from "@/lib/auth";
import { POST } from "./route";

describe("POST /api/auth/logout", () => {
  it("clears the session cookie and returns a success envelope", async () => {
    // Arrange / Act
    const response = await POST();
    const body = await response.json();

    // Assert
    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, data: { loggedOut: true } });

    // The cookie is overwritten with an empty, immediately-expiring value so the
    // browser drops it (Max-Age=0).
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie.toLowerCase()).toContain("max-age=0");
  });
});
