import { Zap, Globe, LayoutDashboard, FileX2 } from "lucide-react";
import { CornerCard } from "@/components/corner-card";

const FEATURES = [
  {
    icon: Zap,
    title: "AI Classification",
    description:
      "Upload a photo or type a description. Our vision model identifies potholes, illegal dumping, broken streetlights, and more — then writes the report in the language your city expects.",
  },
  {
    icon: Globe,
    title: "Works Everywhere",
    description:
      "Unlike 311 apps tied to a single city, Nexa maps issue types to the right agency across jurisdictions. Move from Portland to Phoenix, and it still works.",
  },
  {
    icon: LayoutDashboard,
    title: "Unified Tracking",
    description:
      "Every report you submit lives in one place. See when it was received, assigned, and resolved. No more wondering if your complaint disappeared into the void.",
  },
  {
    icon: FileX2,
    title: "No Forms Needed",
    description:
      "Forget long government forms and confusing phone trees. Describe the problem in plain language and let AI handle the bureaucracy for you.",
  },
];

export function FeaturesSection() {
  return (
    <section id="features" className="w-full px-6 py-12 lg:py-16">
      <div className="mx-auto max-w-[1440px]">
        <div className="mb-12 grid gap-6 lg:grid-cols-2">
          <div>
            <span className="section-label">/ Why Nexa</span>
            <h2 className="mt-4 text-3xl font-normal leading-[1.15] tracking-tight text-foreground/85 sm:text-4xl lg:text-5xl">
              Civic reporting
              <br />
              across every city.
            </h2>
          </div>
          <div className="flex items-end">
            <p className="max-w-md text-sm leading-relaxed text-muted-foreground lg:ml-auto">
              One app that works everywhere. Report issues, track progress,
              hold your city accountable — all from your phone.
            </p>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {FEATURES.map((feature) => (
            <CornerCard key={feature.title}>
              <feature.icon className="mb-4 size-8 text-ep-green" />
              <h3 className="text-base font-semibold text-foreground">
                {feature.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {feature.description}
              </p>
            </CornerCard>
          ))}
        </div>
      </div>
    </section>
  );
}
