import {
  Bot,
  MessageSquare,
  ListTodo,
  Plug,
  BookOpen,
  Cpu,
} from 'lucide-react';

const features = [
  {
    icon: <Bot size={22} color="#6366f1" />,
    color: 'rgba(99, 102, 241, 0.1)',
    title: 'Agents',
    description:
      'Configure personality, system prompt, tools, and MCP server connections per agent.',
  },
  {
    icon: <MessageSquare size={22} color="#8b5cf6" />,
    color: 'rgba(139, 92, 246, 0.1)',
    title: 'Sessions',
    description:
      'Conversational memory per session. Pick up where you left off — history is preserved.',
  },
  {
    icon: <ListTodo size={22} color="#22c55e" />,
    color: 'rgba(34, 197, 94, 0.1)',
    title: 'Tasks',
    description:
      'Structured task pipeline with async runs, streaming output, and step-by-step visibility.',
  },
  {
    icon: <Plug size={22} color="#f59e0b" />,
    color: 'rgba(245, 158, 11, 0.1)',
    title: 'Channels',
    description:
      'Connect to Slack, Discord, Telegram, and more — bring AI to where your team works.',
  },
  {
    icon: <BookOpen size={22} color="#ec4899" />,
    color: 'rgba(236, 72, 153, 0.1)',
    title: 'Skills',
    description:
      'Reusable skill modules that extend agent capabilities — load from the registry or author your own.',
  },
  {
    icon: <Cpu size={22} color="#06b6d4" />,
    color: 'rgba(6, 182, 212, 0.1)',
    title: 'MCP Servers',
    description:
      'Model Context Protocol integration. Connect any MCP-compatible tool or data source.',
  },
];

export default function Home() {
  return (
    <>
      <section className="hero">
        <div className="hero-badge">
          <span>⚡</span> Open Source · Self-hosted · Extensible
        </div>
        <h1 className="hero-title">
          Build agents that actually
          <br />
          <span>do the work</span>
        </h1>
        <p className="hero-subtitle">
          OpenAidy is an open-source AI agent platform with structured tasks,
          conversational memory, multi-channel integrations, and a plugin system
          that grows with you.
        </p>
        <div className="hero-actions">
          <a href="#features">
            <button className="btn-primary">Explore features</button>
          </a>
          <a href="/docs">
            <button className="btn-secondary">Read the docs →</button>
          </a>
        </div>
        <div className="hero-image">
          <img src="/banner.png" alt="OpenAidy platform banner" />
        </div>
      </section>

      <section id="features" className="features">
        <div className="features-header">
          <h2>Everything you need to ship AI agents</h2>
          <p>
            Built for developers who want control without reinventing the wheel.
          </p>
        </div>
        <div className="features-grid">
          {features.map((f) => (
            <div key={f.title} className="feature-card">
              <div
                className="feature-card-icon"
                style={{ background: f.color }}
              >
                {f.icon}
              </div>
              <h3>{f.title}</h3>
              <p>{f.description}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="status-bar">
        <span className="status-dot" />
        Ready to deploy — open source and self-hosted
      </div>
    </>
  );
}
