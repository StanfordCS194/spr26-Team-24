import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { formatFullDateTime } from "@/lib/utils";

import { followUpReminderTemplate } from "./follow-up-reminder";

const CREATED = new Date("2026-05-01T09:00:00.000Z");
const UPDATED = new Date("2026-05-20T09:00:00.000Z");

function build(
  overrides: Partial<Parameters<typeof followUpReminderTemplate>[0]> = {},
) {
  return followUpReminderTemplate({
    name: "Ada",
    reportId: "report_123",
    issueType: "ROAD_DAMAGE",
    address: "100 Main St",
    createdAt: CREATED,
    updatedAt: UPDATED,
    externalTrackingId: "TRK-9",
    summary: "Deep pothole",
    ...overrides,
  });
}

describe("followUpReminderTemplate — subject", () => {
  it("names the human-readable issue label", () => {
    expect(build().subject).toBe(
      "Follow-up recommended for your Road Damage report",
    );
  });

  it("falls back to a generic phrase for a null issue type", () => {
    expect(build({ issueType: null }).subject).toBe(
      "Follow-up recommended for your an infrastructure issue report",
    );
  });

  it("passes through an unknown issue type verbatim", () => {
    expect(build({ issueType: "MYSTERY" }).subject).toContain("MYSTERY");
  });
});

describe("followUpReminderTemplate — body content", () => {
  it("greets the named recipient and includes the reference id", () => {
    const { html } = build();
    expect(html).toContain("Check in on your report, Ada");
    expect(html).toContain("report_123");
  });

  it("defaults the greeting to 'there' when the name is empty", () => {
    expect(build({ name: "" }).html).toContain(
      "Check in on your report, there",
    );
  });

  it("renders the formatted submitted and last-updated dates", () => {
    const { html } = build();
    expect(html).toContain(formatFullDateTime(CREATED));
    expect(html).toContain(formatFullDateTime(UPDATED));
  });

  it("includes the optional address, tracking id, and summary rows when present", () => {
    const { html } = build();
    expect(html).toContain("100 Main St");
    expect(html).toContain("TRK-9");
    expect(html).toContain("Deep pothole");
  });

  it("omits the optional rows when their values are null", () => {
    const { html } = build({
      address: null,
      externalTrackingId: null,
      summary: null,
    });
    expect(html).not.toContain(">Location<");
    expect(html).not.toContain(">Tracking ID<");
    expect(html).not.toContain(">Summary<");
  });

  it("always carries the app-side-tracking-only disclaimer", () => {
    expect(build().html).toContain("app-side tracking only");
  });
});

describe("followUpReminderTemplate — escaping & app url", () => {
  it("HTML-escapes user-controlled values to prevent injection", () => {
    const { html } = build({
      name: "<script>x</script>",
      address: 'A & B "lane"',
    });
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("A &amp; B &quot;lane&quot;");
  });

  describe("app url resolution", () => {
    const original = process.env.NEXT_PUBLIC_APP_URL;
    beforeEach(() => {
      delete process.env.NEXT_PUBLIC_APP_URL;
    });
    afterEach(() => {
      if (original === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = original;
    });

    it("falls back to localhost when NEXT_PUBLIC_APP_URL is unset", () => {
      expect(build().html).toContain("http://localhost:3000/dashboard");
    });

    it("uses the configured app url when set", () => {
      process.env.NEXT_PUBLIC_APP_URL = "https://nexa.example.gov";
      expect(build().html).toContain("https://nexa.example.gov/dashboard");
    });
  });
});
