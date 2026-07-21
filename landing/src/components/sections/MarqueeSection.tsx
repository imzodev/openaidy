import { Marquee } from '../ui';

const INTEGRATIONS = [
  'Slack',
  'Discord',
  'Telegram',
  'GitHub',
  'Linear',
  'Notion',
  'Slack',
  'Discord',
  'Telegram',
  'GitHub',
  'Linear',
  'Notion',
];

export function MarqueeSection() {
  return (
    <section className="marquee-section">
      <Marquee speed={35}>
        {INTEGRATIONS.map((name, i) => (
          <span key={i} className="marquee-item">
            <span className="marquee-dot" />
            {name}
          </span>
        ))}
      </Marquee>
    </section>
  );
}
