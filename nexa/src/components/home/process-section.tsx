import Link from "next/link";
import { Camera, Zap, CheckCircle2, ArrowRight } from "lucide-react";

const STEPS = [
  {
    icon: Camera,
    title: "Describe the problem",
    description: "Photos, text, or both — whatever is easiest for you.",
  },
  {
    icon: Zap,
    title: "AI classifies & routes",
    description: "Identifies issue type, severity, and the responsible agency.",
  },
  {
    icon: CheckCircle2,
    title: "Report filed",
    description: "Review, confirm, done — all in under 30 seconds.",
  },
];

export function ProcessSection() {
  return (
    <section id="how-it-works" className="w-full px-6 py-12 lg:py-16">
      <div className="mx-auto max-w-[1440px]">
        <div className="grid items-start gap-12 lg:grid-cols-2 lg:gap-20">
          <div className="ep-card flex aspect-video items-center justify-center bg-muted/50">
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <Camera className="size-12 text-muted-foreground/50" />
              <span className="font-mono text-xs uppercase tracking-wider">
                Demo video coming soon
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-8">
            <div>
              <span className="section-label">/ How It Works</span>
              <h2 className="mt-4 text-3xl font-normal leading-[1.15] tracking-tight text-foreground/85 sm:text-4xl lg:text-5xl">
                Watch Nexa handle
                <br />
                your report
              </h2>
            </div>

            <div className="flex flex-col gap-6">
              {STEPS.map((step) => (
                <div key={step.title} className="flex items-start gap-4">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-ep-green-light">
                    <step.icon className="size-5 text-ep-green" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">
                      {step.title}
                    </h3>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {step.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <Link href="/report" className="btn-cta btn-cta-purple w-fit">
              Try It Now
              <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
