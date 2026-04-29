import Link from "next/link";
import { Camera, Zap, CheckCircle2, ArrowRight } from "lucide-react";

const STEPS = [
  {
    number: "01",
    icon: Camera,
    title: "Describe the problem",
    description:
      "Upload a photo, type a description, or both. Whatever is easiest.",
  },
  {
    number: "02",
    icon: Zap,
    title: "AI classifies & routes",
    description:
      "Identifies the issue type, severity, and the responsible city agency.",
  },
  {
    number: "03",
    icon: CheckCircle2,
    title: "Report filed",
    description: "Review, confirm, done. The whole process takes under 30 seconds.",
  },
];

export function ProcessSection() {
  return (
    <section id="how-it-works" className="w-full px-6 py-20 lg:py-28">
      <div className="mx-auto max-w-[1440px]">
        <div className="mb-16">
          <span className="section-label">/ How It Works</span>
          <h2 className="mt-4 max-w-lg text-3xl font-normal leading-[1.1] tracking-tight sm:text-4xl lg:text-5xl">
            Three steps from problem to report.
          </h2>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {STEPS.map((step) => (
            <div key={step.title} className="ep-card flex flex-col gap-5 p-8">
              <div className="flex items-center justify-between">
                <div className="flex size-10 items-center justify-center rounded-lg bg-ep-green-light">
                  <step.icon className="size-5 text-ep-green" />
                </div>
                <span className="font-mono text-xs text-muted-foreground">
                  {step.number}
                </span>
              </div>
              <div>
                <h3 className="text-base font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {step.description}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-10">
          <Link href="/report" className="btn-cta btn-cta-purple w-fit">
            Try It Now
            <ArrowRight className="size-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
