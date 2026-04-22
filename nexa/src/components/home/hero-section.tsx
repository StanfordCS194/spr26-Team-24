import Link from "next/link";
import { Camera, Zap, ArrowRight, Shield, MapPin } from "lucide-react";

const HIGHLIGHTS = [
  {
    icon: Camera,
    title: "Snap & describe",
    description:
      "Take a photo or describe the issue. Our AI classifies it instantly, just like a trained city worker.",
  },
  {
    icon: Shield,
    title: "Verify before sending",
    description:
      "Review the AI classification and adjust if needed. You stay in control of every report before it ships.",
  },
  {
    icon: MapPin,
    title: "Route anywhere",
    description:
      "Auto-detect your location and route to the right agency. Works across cities and jurisdictions.",
  },
];

export function HeroSection() {
  return (
    <section className="relative w-full">
      <div className="mx-auto max-w-[1440px] px-6">
        <div className="ep-card grid-bg relative overflow-hidden">
          <div className="flex flex-col items-center px-4 pb-12 pt-20 text-center lg:px-8 lg:pb-16 lg:pt-24">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-ep-green/20 bg-ep-green-light px-4 py-1.5">
              <Zap className="size-3.5 text-ep-green" />
              <span className="font-mono text-xs font-medium uppercase tracking-wider text-ep-green">
                AI-Powered Civic Reporting
              </span>
            </div>

            <h1 className="max-w-3xl text-4xl font-normal leading-[1.15] tracking-tight text-foreground/85 sm:text-5xl lg:text-[3.5rem]">
              Report neighborhood issues.
              <br />
              We handle the rest.
            </h1>

            <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              Show us the problem. We learn which department to call,
              <br className="hidden sm:block" />
              what form to fill out, and how to file it.
            </p>

            <div className="mt-10 flex flex-col gap-3 sm:flex-row">
              <Link href="/report" className="btn-cta btn-cta-purple">
                Report an Issue
                <ArrowRight className="size-4" />
              </Link>
              <a href="#how-it-works" className="btn-cta btn-cta-outline">
                See How It Works
              </a>
            </div>
          </div>

          <div className="border-t border-border px-4 py-12 lg:px-8 lg:py-16">
            <div className="grid gap-8 md:grid-cols-3">
              {HIGHLIGHTS.map((item) => (
                <div key={item.title} className="flex flex-col gap-3">
                  <item.icon className="size-8 text-ep-green" />
                  <h3 className="text-base font-semibold text-foreground">
                    {item.title}
                  </h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {item.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
