import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Navbar } from "@/components/navbar";
import { PostHogProvider } from "@/components/posthog-provider";
import { I18nProvider } from "@/i18n/provider";
import "leaflet/dist/leaflet.css";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Nexa — Snap a Photo, We'll Handle City Hall",
  description:
    "Report neighborhood issues to your city in seconds. AI-powered civic reporting that knows which department to call and how to file it.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <I18nProvider>
          <PostHogProvider>
            <Navbar />
            {children}
          </PostHogProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
