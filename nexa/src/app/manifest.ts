import type { MetadataRoute } from "next";

// Web app manifest — first piece of the PWA work (issue #41). Makes Nexa
// installable to a phone home screen so field reporting feels like a native
// app. Service worker + offline queueing are the follow-up pieces.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Nexa — Civic Issue Reporting",
    short_name: "Nexa",
    description:
      "Report neighborhood issues to your city in seconds. AI-powered civic reporting.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#14b8a6",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
