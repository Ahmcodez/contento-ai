import MarketingNav from '@/components/layout/MarketingNav';
import Footer from '@/components/layout/Footer';
import Hero from '@/components/marketing/Hero';
import HowItWorks from '@/components/marketing/HowItWorks';
import WhyChooseUs from '@/components/marketing/WhyChooseUs';
import FeatureShowcase from '@/components/marketing/FeatureShowcase';
import ExampleOutput from '@/components/marketing/ExampleOutput';
import PricingTeaser from '@/components/marketing/PricingTeaser';
import FinalCta from '@/components/marketing/FinalCta';

export default function Home() {
  return (
    <>
      <MarketingNav />
      <main>
        <Hero />
        <HowItWorks />
        <WhyChooseUs />
        <FeatureShowcase />
        <ExampleOutput />
        <PricingTeaser />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
