import { Zap, Globe, LayoutDashboard, FileX2 } from "lucide-react";

const FEATURES = [
  {
    icon: Zap,
    title: "AI Classification",
    description:
      "Upload a photo or type a description. Our vision model identifies potholes, illegal dumping, broken streetlights, and more.",
  },
  {
    icon: Globe,
    title: "Works Everywhere",
    description:
      "Unlike 311 apps tied to a single city, Nexa maps issue types to the right agency across jurisdictions.",
  },
  {
    icon: LayoutDashboard,
    title: "Unified Tracking",
    description:
      "Every report lives in one place. See when it was received, assigned, and resolved.",
  },
  {
    icon: FileX2,
    title: "No Forms Needed",
    description:
      "Describe the problem in plain language and let AI handle the bureaucracy for you.",
  },
];

export function FeaturesSection() {
  return (
    <section id="features" className="w-full px-6 py-20 lg:py-28">
      <div className="mx-auto max-w-[1440px]">
        <div className="mb-16 grid gap-6 lg:grid-cols-2">
          <div>
            <span className="section-label">/ Why Nexa</span>
            <h2 className="mt-4 max-w-md text-3xl font-normal leading-[1.1] tracking-tight sm:text-4xl lg:text-5xl">
              Civic reporting that actually works.
            </h2>
          </div>
          <div className="flex items-end">
            <p className="max-w-md text-sm leading-relaxed text-muted-foreground lg:ml-auto">
              One app that works everywhere. Report issues, track progress, and
              hold your city accountable.
            </p>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="ep-card p-8">
              <div className="mb-4 flex size-10 items-center justify-center rounded-lg bg-ep-green-light">
                <feature.icon className="size-5 text-ep-green" />
              </div>
              <h3 className="text-base font-semibold">{feature.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
