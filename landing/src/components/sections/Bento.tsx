import {
  Bot,
  Brain,
  CalendarClock,
  Cpu,
  MessageCircle,
  Puzzle,
} from 'lucide-react';
import { Reveal } from '../ui';

type Tile = {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  body: string;
  size: 'wide' | 'tall' | 'small';
  tone: 'blue' | 'green' | 'orange' | 'indigo' | 'pink' | 'teal';
};

const TILES: Tile[] = [
  {
    icon: <Bot size={26} />,
    eyebrow: 'Agents',
    title: 'A team, not a chatbot.',
    body: 'Give each agent its own role, tools and personality. They hand work to each other and finish it.',
    size: 'wide',
    tone: 'blue',
  },
  {
    icon: <MessageCircle size={26} />,
    eyebrow: 'Channels',
    title: 'Right where you are.',
    body: 'Talk to your agents on WhatsApp and Discord. They can answer your customers too — and know who is who.',
    size: 'tall',
    tone: 'green',
  },
  {
    icon: <Brain size={26} />,
    eyebrow: 'Memory',
    title: 'It remembers.',
    body: 'Preferences, people and decisions carry over to every conversation and every agent.',
    size: 'small',
    tone: 'indigo',
  },
  {
    icon: <CalendarClock size={26} />,
    eyebrow: 'Always on',
    title: 'Works while you sleep.',
    body: 'Morning briefings, reminders, alerts and workflows that run on schedule and only ping you when it matters.',
    size: 'small',
    tone: 'orange',
  },
  {
    icon: <Puzzle size={26} />,
    eyebrow: 'Extensible',
    title: 'Plugs into everything.',
    body: 'MCP servers, skills and add-ons connect Aidy to Notion, GitHub, Supabase and your own tools.',
    size: 'small',
    tone: 'pink',
  },
  {
    icon: <Cpu size={26} />,
    eyebrow: 'Any model',
    title: 'Bring your own brain.',
    body: 'OpenAI, Anthropic, Gemini, DeepSeek or a local model — and choose how hard it thinks.',
    size: 'wide',
    tone: 'teal',
  },
];

export function Bento() {
  return (
    <section className="section bento-section" id="features">
      <div className="section-inner">
        <Reveal className="section-head--center">
          <h2 className="section-title">Everything an assistant should be.</h2>
          <p className="section-lede">
            One place to run agents that work for you — and with you.
          </p>
        </Reveal>

        <div className="bento-grid">
          {TILES.map((t, i) => (
            <Reveal
              key={t.title}
              delay={(i % 3) * 0.08}
              className={`bento-tile bento-tile--${t.size} bento-tone--${t.tone}`}
            >
              <span className="bento-icon">{t.icon}</span>
              <span className="bento-eyebrow">{t.eyebrow}</span>
              <h3 className="bento-title">{t.title}</h3>
              <p className="bento-body">{t.body}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
