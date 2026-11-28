import { Hero } from '../components/sections/Hero';
import { Bento } from '../components/sections/Bento';
import { Story } from '../components/story/Story';
import { Privacy } from '../components/sections/Privacy';
import { Install } from '../components/sections/Install';

export default function Home() {
  return (
    <>
      <Hero />
      <Bento />
      <Story />
      <Privacy />
      <Install />
    </>
  );
}
