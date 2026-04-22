import { CornerCard } from "@/components/corner-card";

const STATS = [
  { value: "30s", label: "Average report time" },
  { value: "80%", label: "Routing accuracy target" },
  { value: "5", label: "Issue types supported" },
];

const NARRATIVE = [
  {
    label: "/ Challenge",
    text: "No single place to report civic issues. Potholes, dumping, broken lights — each goes to a different agency with a different form.",
  },
  {
    label: "/ Solution",
    text: "Nexa uses AI to classify your report, determine the right agency based on GPS, and prepare a properly formatted submission.",
  },
  {
    label: "/ Result",
    text: "What used to take 15 minutes of research and form-filling now takes 30 seconds with a photo and a tap.",
  },
];

export function StatsSection() {
  return (
    <section id="stats" className="section-gray w-full px-6 py-12 lg:py-16">
      <div className="mx-auto max-w-[1440px]">
        <div className="mb-12">
          <span className="section-label">/ By The Numbers</span>
          <h2 className="mt-4 text-3xl font-normal leading-[1.15] tracking-tight text-foreground/85 sm:text-4xl lg:text-5xl">
            Reporting made radically
            <br />
            simpler.
          </h2>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <CornerCard>
            <h3 className="text-lg font-semibold text-foreground">
              The problem today
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              &ldquo;We went from noticing a pothole every day on our commute to
              actually filing a proper report in under a minute. No googling, no
              phone trees.&rdquo;
            </p>

            <div className="mt-8 grid grid-cols-3 gap-6">
              {STATS.map((stat) => (
                <div key={stat.label}>
                  <div className="text-3xl font-normal text-ep-green lg:text-4xl">
                    {stat.value}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {stat.label}
                  </div>
                </div>
              ))}
            </div>
          </CornerCard>

          <CornerCard className="flex flex-col gap-8">
            {NARRATIVE.map((item) => (
              <div key={item.label}>
                <span className="section-label">{item.label}</span>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {item.text}
                </p>
              </div>
            ))}
          </CornerCard>
        </div>
      </div>
    </section>
  );
}
