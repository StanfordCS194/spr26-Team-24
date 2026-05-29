import Link from "next/link";
import { Camera, Zap, ArrowRight, Shield, MapPin } from "lucide-react";

const HIGHLIGHTS = [
  {
    icon: Camera,
    title: "Snap & describe",
    description:
      "Take a photo or describe the issue. Our AI classifies it instantly.",
  },
  {
    icon: Shield,
    title: "Verify before sending",
    description:
      "Review the AI classification and adjust if needed. You stay in control.",
  },
  {
    icon: MapPin,
    title: "Route anywhere",
    description:
      "Auto-detect your location and route to the right city agency.",
  },
];

export function HeroSection() {
  return (
    <section className="relative w-full">
      <div className="mx-auto max-w-[1440px] px-6">
        <div className="flex flex-col items-center px-4 pb-16 pt-16 text-center lg:px-8 lg:pb-20 lg:pt-20">
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-ep-green/20 bg-ep-green-light px-4 py-1.5">
            <Zap className="size-3.5 text-ep-green" />
            <span className="font-mono text-xs font-medium uppercase tracking-wider text-ep-green">
              AI-Powered Civic Reporting
            </span>
          </div>

          <h1 className="max-w-3xl text-4xl font-normal leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl">
            Report neighborhood issues.
            <br />
            <span className="text-muted-foreground">We handle the rest.</span>
          </h1>

          <p className="mt-6 max-w-lg text-base leading-relaxed text-muted-foreground sm:text-lg">
            Show us the problem. Nexa figures out which department to call, what
            form to fill out, and how to file it.
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

        <div className="border-t border-border px-4 py-16 lg:px-0 lg:py-20">
          <div className="grid gap-12 md:grid-cols-3 md:gap-8">
            {HIGHLIGHTS.map((item) => (
              <div key={item.title} className="flex flex-col gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-ep-green-light">
                  <item.icon className="size-5 text-ep-green" />
                </div>
                <h3 className="text-base font-semibold">{item.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
