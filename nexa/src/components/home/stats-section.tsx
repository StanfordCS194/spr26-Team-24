const STATS = [
  { value: "30s", label: "Average report time" },
  { value: "80%", label: "Routing accuracy target" },
  { value: "5", label: "Issue types supported" },
];

const NARRATIVE = [
  {
    label: "/ Challenge",
    text: "No single place to report civic issues. Potholes, dumping, broken lights — each goes to a different agency with a different process.",
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
    <section id="stats" className="w-full border-y border-border bg-muted/30 px-6 py-20 lg:py-28">
      <div className="mx-auto max-w-[1440px]">
        <div className="mb-16">
          <span className="section-label">/ By The Numbers</span>
          <h2 className="mt-4 max-w-lg text-3xl font-normal leading-[1.1] tracking-tight sm:text-4xl lg:text-5xl">
            Reporting made radically simpler.
          </h2>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="ep-card p-8 lg:p-10">
            <div className="grid grid-cols-3 gap-6">
              {STATS.map((stat) => (
                <div key={stat.label}>
                  <div className="text-3xl font-normal text-ep-green lg:text-4xl">
                    {stat.value}
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {stat.label}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="ep-card flex flex-col gap-6 p-8 lg:p-10">
            {NARRATIVE.map((item, i) => (
              <div key={item.label}>
                {i > 0 && <div className="mb-6 h-px bg-border" />}
                <span className="section-label">{item.label}</span>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {item.text}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
