import { useEffect, useState, useRef } from 'react';
import { motion, useScroll, useTransform, useInView } from 'framer-motion';
import {
  Bot,
  MessageSquare,
  ListTodo,
  Plug,
  BookOpen,
  Cpu,
  ArrowRight,
  Zap,
  Github,
} from 'lucide-react';

// ── Floating background orbs ───────────────────────────────────────────────
function FloatingOrbs() {
  return (
    <div className="orbs-container" aria-hidden="true">
      <div className="orb orb-1" />
      <div className="orb orb-2" />
      <div className="orb orb-3" />
      <div className="grid-overlay" />
    </div>
  );
}

// ── Typewriter headline ──────────────────────────────────────────────────────
function TypewriterLine({ text, delay = 0 }: { text: string; delay?: number }) {
  const [displayed, setDisplayed] = useState('');
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const startTimeout = setTimeout(() => setStarted(true), delay * 1000);
    return () => clearTimeout(startTimeout);
  }, [delay]);

  useEffect(() => {
    if (!started) return;
    let i = 0;
    const interval = setInterval(() => {
      setDisplayed(text.slice(0, i + 1));
      i++;
      if (i >= text.length) clearInterval(interval);
    }, 45);
    return () => clearInterval(interval);
  }, [started, text]);

  return (
    <span>
      {displayed}
      <span className="cursor" />
    </span>
  );
}

// ── Animated feature card ───────────────────────────────────────────────────
function FeatureCard({
  icon,
  color,
  title,
  description,
  index,
}: {
  icon: React.ReactNode;
  color: string;
  title: string;
  description: string;
  index: number;
}) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });

  return (
    <motion.div
      ref={ref}
      className="feature-card"
      initial={{ opacity: 0, y: 60, scale: 0.95 }}
      animate={inView ? { opacity: 1, y: 0, scale: 1 } : {}}
      transition={{
        duration: 0.5,
        delay: (index % 3) * 0.1,
        ease: [0.16, 1, 0.3, 1],
      }}
      whileHover={{ y: -6, scale: 1.02 }}
    >
      <motion.div
        className="feature-card-icon"
        style={{ background: color }}
        whileHover={{ rotate: [0, -5, 5, 0], scale: 1.1 }}
        transition={{ duration: 0.3 }}
      >
        {icon}
      </motion.div>
      <h3>{title}</h3>
      <p>{description}</p>
      <div className="feature-card-arrow">
        <ArrowRight size={14} />
      </div>
    </motion.div>
  );
}

// ── Stats counter ─────────────────────────────────────────────────────────────
function StatCounter({ value, label }: { value: string; label: string }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true });

  return (
    <motion.div
      ref={ref}
      className="stat-item"
      initial={{ opacity: 0, y: 20 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5, ease: 'easeOut' }}
    >
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </motion.div>
  );
}

// ── Main Home ────────────────────────────────────────────────────────────────
const features = [
  {
    icon: <Bot size={22} color="#6366f1" />,
    color: 'rgba(99, 102, 241, 0.12)',
    title: 'Agents',
    description:
      'Configure personality, system prompt, tools, and MCP server connections per agent.',
  },
  {
    icon: <MessageSquare size={22} color="#8b5cf6" />,
    color: 'rgba(139, 92, 246, 0.12)',
    title: 'Sessions',
    description:
      'Conversational memory per session. Pick up where you left off — history is preserved.',
  },
  {
    icon: <ListTodo size={22} color="#22c55e" />,
    color: 'rgba(34, 197, 94, 0.12)',
    title: 'Tasks',
    description:
      'Structured task pipeline with async runs, streaming output, and step-by-step visibility.',
  },
  {
    icon: <Plug size={22} color="#f59e0b" />,
    color: 'rgba(245, 158, 11, 0.12)',
    title: 'Channels',
    description:
      'Connect to Slack, Discord, Telegram, and more — bring AI to where your team works.',
  },
  {
    icon: <BookOpen size={22} color="#ec4899" />,
    color: 'rgba(236, 72, 153, 0.12)',
    title: 'Skills',
    description:
      'Reusable skill modules that extend agent capabilities — load from the registry or author your own.',
  },
  {
    icon: <Cpu size={22} color="#06b6d4" />,
    color: 'rgba(6, 182, 212, 0.12)',
    title: 'MCP Servers',
    description:
      'Model Context Protocol integration. Connect any MCP-compatible tool or data source.',
  },
];

const stats = [
  { value: '6+', label: 'Integrations' },
  { value: '100%', label: 'Open Source' },
  { value: 'Self-hosted', label: 'Deploy anywhere' },
];

export default function Home() {
  const heroRef = useRef(null);
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ['start start', 'end start'],
  });
  const heroOpacity = useTransform(scrollYProgress, [0, 0.6], [1, 0]);
  const heroScale = useTransform(scrollYProgress, [0, 0.6], [1, 0.95]);
  const bannerY = useTransform(scrollYProgress, [0, 1], ['0%', '25%']);

  return (
    <>
      <FloatingOrbs />

      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <motion.section
        ref={heroRef}
        className="hero"
        style={{ opacity: heroOpacity, scale: heroScale }}
      >
        <motion.div
          className="hero-badge"
          initial={{ opacity: 0, y: -20, scale: 0.8 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.6, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          <Zap size={12} />
          <span>Open Source · Self-hosted · Extensible</span>
        </motion.div>

        <motion.h1
          className="hero-title"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
        >
          Build agents that{' '}
          <span className="gradient-text">
            <TypewriterLine text="actually do the work" delay={0.7} />
          </span>
        </motion.h1>

        <motion.p
          className="hero-subtitle"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 1.2, ease: 'easeOut' }}
        >
          OpenAidy is an open-source AI agent platform with structured tasks,
          conversational memory, multi-channel integrations, and a plugin system
          that grows with you.
        </motion.p>

        <motion.div
          className="hero-actions"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 1.5, ease: 'easeOut' }}
        >
          <motion.a
            href="#features"
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.97 }}
          >
            <button className="btn-primary">Explore features</button>
          </motion.a>
          <motion.a
            href="/docs"
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.97 }}
          >
            <button className="btn-secondary">
              <BookOpen size={15} />
              Read the docs
            </button>
          </motion.a>
        </motion.div>

        <motion.div
          className="hero-banner"
          style={{ y: bannerY }}
          initial={{ opacity: 0, y: 60, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.8, delay: 1.8, ease: [0.16, 1, 0.3, 1] }}
        >
          <img src="/banner.png" alt="OpenAidy platform banner" />
          <div className="banner-glow" />
        </motion.div>
      </motion.section>

      {/* ── Stats ─────────────────────────────────────────────────────── */}
      <motion.section
        className="stats-section"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, margin: '-50px' }}
        transition={{ duration: 0.6 }}
      >
        <div className="stats-inner">
          {stats.map((s) => (
            <StatCounter key={s.label} value={s.value} label={s.label} />
          ))}
        </div>
      </motion.section>

      {/* ── Features ──────────────────────────────────────────────────── */}
      <section id="features" className="features">
        <motion.div
          className="features-header"
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-50px' }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        >
          <h2>Everything you need to ship AI agents</h2>
          <p>
            Built for developers who want control without reinventing the wheel.
          </p>
        </motion.div>

        <div className="features-grid">
          {features.map((f, i) => (
            <FeatureCard key={f.title} {...f} index={i} />
          ))}
        </div>
      </section>

      {/* ── CTA section ────────────────────────────────────────────────── */}
      <motion.section
        className="cta-section"
        initial={{ opacity: 0, y: 60 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-50px' }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="cta-glow" />
        <h2>Ready to build?</h2>
        <p>
          Clone the repo, run one command, and your AI agent platform is live.
        </p>
        <motion.a
          href="https://github.com/imzodev/openaidy"
          target="_blank"
          rel="noopener noreferrer"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.97 }}
        >
          <button className="btn-primary btn-large">
            <Github size={18} />
            View on GitHub
          </button>
        </motion.a>
      </motion.section>
    </>
  );
}
