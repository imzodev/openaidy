import { HardDrive, KeyRound, Code2 } from 'lucide-react';
import { Reveal } from '../ui';

const POINTS = [
  {
    icon: <HardDrive size={22} />,
    title: 'Runs on your machine',
    body: 'Your laptop, a $6 server or your office box. Conversations and memory stay in a local database.',
  },
  {
    icon: <KeyRound size={22} />,
    title: 'Your keys, your models',
    body: 'Connect the providers you already pay for. Credentials are encrypted at rest.',
  },
  {
    icon: <Code2 size={22} />,
    title: 'Open source',
    body: 'Read every line, change anything, and back up or move your whole install in one file.',
  },
];

export function Privacy() {
  return (
    <section className="section privacy-section">
      <div className="section-inner">
        <Reveal className="section-head--center">
          <span className="section-eyebrow">Self-hosted</span>
          <h2 className="section-title">
            Your data never leaves
            <br />
            your server.
          </h2>
          <p className="section-lede">
            Aidy isn&apos;t a cloud service. It&apos;s software you own, running
            where you choose.
          </p>
        </Reveal>

        <div className="privacy-grid">
          {POINTS.map((p, i) => (
            <Reveal key={p.title} delay={i * 0.08} className="privacy-point">
              <span className="privacy-icon">{p.icon}</span>
              <h3>{p.title}</h3>
              <p>{p.body}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
