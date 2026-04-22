import { HeroSection } from "@/components/home/hero-section";
import { ProcessSection } from "@/components/home/process-section";
import { StatsSection } from "@/components/home/stats-section";
import { FeaturesSection } from "@/components/home/features-section";
import { BottomCTA } from "@/components/home/bottom-cta";
import { Footer } from "@/components/home/footer";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col pt-6">
      <HeroSection />
      <ProcessSection />
      <StatsSection />
      <FeaturesSection />
      <BottomCTA />
      <Footer />
    </main>
  );
}
