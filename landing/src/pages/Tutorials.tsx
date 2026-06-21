import { motion } from 'framer-motion';
import {
  MessageSquare,
  Clock,
  Puzzle,
  Zap,
  BookOpen,
  ArrowRight,
} from 'lucide-react';

const tutorials = [
  {
    icon: <MessageSquare size={24} />,
    title: 'Connect WhatsApp to OpenAidy',
    description:
      'Connect your WhatsApp number so agents can handle real conversations. This guide walks through channel setup, authentication, and receiving your first message.',
    time: '10 min',
    level: 'Getting Started',
    href: '/docs/channels',
  },
  {
    icon: <Clock size={24} />,
    title: 'Schedule Your First Agent Task',
    description:
      'Automate agent work with cron jobs and one-shot tasks. Learn how to set up recurring jobs, define schedules, and monitor execution history.',
    time: '15 min',
    level: 'Getting Started',
    href: '/docs/user/scheduler',
  },
  {
    icon: <Puzzle size={24} />,
    title: 'Build a Custom Plugin',
    description:
      'Extend OpenAidy with your own tools and integrations. This tutorial covers the plugin SDK, defining tool schemas, and registering plugins with the control plane.',
    time: '25 min',
    level: 'Intermediate',
    href: '/docs/plugin-sdk',
  },
  {
    icon: <Zap size={24} />,
    title: 'Use Sessions for Multi-Turn Conversations',
    description:
      'Sessions keep context across multiple messages, letting agents remember and build on prior exchanges. Learn how sessions work, how to manage them, and how to clear context when needed.',
    time: '10 min',
    level: 'Getting Started',
    href: '/docs/user/sessions',
  },
  {
    icon: <BookOpen size={24} />,
    title: 'Set Up MCP Servers',
    description:
      'Connect Model Context Protocol servers to give your agents access to external data sources and tools. This guide covers discovery, configuration, and testing MCP integrations.',
    time: '20 min',
    level: 'Intermediate',
    href: '/docs/user/agents',
  },
];

const levelColors: Record<string, string> = {
  'Getting Started': '#22c55e',
  Intermediate: '#f59e0b',
  Advanced: '#ef4444',
};

export default function Tutorials() {
  return (
    <div className="tutorials-page">
      {/* Hero */}
      <section className="tutorials-hero">
        <div className="orbs-container" aria-hidden="true">
          <div className="orb orb-1" />
          <div className="orb orb-2" />
          <div className="orb orb-3" />
          <div className="grid-overlay" />
        </div>
        <div className="tutorials-hero-content">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          >
            <span className="tutorials-eyebrow">Tutorials</span>
            <h1>Learn OpenAidy step by step</h1>
            <p>
              From first install to advanced agent workflows — practical guides
              to get the most out of OpenAidy.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Tutorial Cards */}
      <section className="tutorials-grid-section">
        <div className="tutorials-container">
          <div className="tutorials-grid">
            {tutorials.map((tutorial, index) => (
              <motion.a
                key={tutorial.title}
                href={tutorial.href}
                className="tutorial-card"
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-80px' }}
                transition={{
                  duration: 0.5,
                  ease: [0.16, 1, 0.3, 1],
                  delay: index * 0.08,
                }}
              >
                <div className="tutorial-card-icon">{tutorial.icon}</div>
                <div className="tutorial-card-body">
                  <div className="tutorial-card-meta">
                    <span
                      className="tutorial-level"
                      style={{
                        color: levelColors[tutorial.level] ?? '#8888a0',
                      }}
                    >
                      {tutorial.level}
                    </span>
                    <span className="tutorial-time">{tutorial.time}</span>
                  </div>
                  <h3>{tutorial.title}</h3>
                  <p>{tutorial.description}</p>
                </div>
                <div className="tutorial-card-arrow">
                  <ArrowRight size={16} />
                </div>
              </motion.a>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="tutorials-cta">
        <div className="tutorials-container">
          <motion.div
            className="tutorials-cta-box"
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          >
            <h2>Ready to dive deeper?</h2>
            <p>
              Check the full documentation for complete API reference,
              architecture docs, and more tutorials.
            </p>
            <a href="/docs" className="cta-button">
              Read the Docs
              <ArrowRight size={16} />
            </a>
          </motion.div>
        </div>
      </section>
    </div>
  );
}
