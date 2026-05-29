import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function BottomCTA() {
  return (
    <section className="w-full px-6 py-12">
      <div className="mx-auto max-w-[1440px]">
        <div className="rounded-2xl bg-[var(--ep-cta-bg)] px-8 py-20 text-center lg:px-16">
          <span className="font-mono text-xs font-medium uppercase tracking-wider text-white/40">
            / Get Started
          </span>
          <h2 className="mt-4 text-3xl font-normal leading-[1.1] tracking-tight text-white sm:text-4xl lg:text-5xl">
            See a problem?
            <br />
            Report it in 30 seconds.
          </h2>
          <p className="mx-auto mt-6 max-w-md text-base leading-relaxed text-white/60">
            No forms. No phone trees. No figuring out which department to call.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/report" className="btn-cta btn-cta-purple">
              Report an Issue
              <ArrowRight className="size-4" />
            </Link>
            <a href="#how-it-works" className="btn-cta btn-cta-white-outline">
              Learn More
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
