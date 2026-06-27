import { FloatingOrbs } from '../components/ui';
import { Hero } from '../components/sections/Hero';
import { MarqueeSection } from '../components/sections/MarqueeSection';
import { Story } from '../components/story/Story';
import { Showcase } from '../components/sections/Showcase';
import { CTA } from '../components/sections/CTA';

export default function Home() {
  return (
    <>
      <FloatingOrbs />
      <Hero />
      <MarqueeSection />
      <Story />
      <Showcase />
      <CTA />
    </>
  );
}
