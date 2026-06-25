import { useEffect, useRef, useState } from 'react';
import {
  motion,
  useMotionValue,
  useTransform,
  useInView,
  useScroll,
} from 'framer-motion';
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

// ── Types ─────────────────────────────────────────────────────────────────
interface Feature {
  icon: React.ReactNode;
  color: string;
  title: string;
  description: string;
}

// ── Floating orbs (pure CSS — no JS) ──────────────────────────────────────
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

// ── Typewriter ───────────────────────────────────────────────────────────
function TypewriterText({ text, start }: { text: string; start: boolean }) {
  const [displayed, setDisplayed] = useState('');
  useEffect(() => {
    if (!start) return;
    let i = 0;
    const t = setInterval(() => {
      setDisplayed(text.slice(0, i + 1));
      i++;
      if (i >= text.length) clearInterval(t);
    }, 50);
    return () => clearInterval(t);
  }, [start, text]);
  return (
    <span>
      {displayed}
      <span className="cursor" />
    </span>
  );
}

// ── Magnetic Button ──────────────────────────────────────────────────────
function MagneticButton({
  children,
  href,
  className,
}: {
  children: React.ReactNode;
  href?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    x.set((e.clientX - cx) * 0.2);
    y.set((e.clientY - cy) * 0.2);
  };

  const handleMouseLeave = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ display: 'inline-block' }}
    >
      {href ? (
        <a href={href} className={className}>
          <motion.span
            style={{
              x,
              y,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
            transition={{ type: 'spring', stiffness: 200, damping: 20 }}
          >
            {children}
          </motion.span>
        </a>
      ) : (
        <motion.span
          style={{ x, y }}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        >
          {children}
        </motion.span>
      )}
    </motion.div>
  );
}

// ── Marquee ──────────────────────────────────────────────────────────────
function Marquee({
  children,
  speed = 40,
}: {
  children: React.ReactNode;
  speed?: number;
}) {
  return (
    <div className="marquee-track">
      <div
        className="marquee-content"
        style={{ animationDuration: `${speed}s` }}
      >
        {children}
        {children}
      </div>
    </div>
  );
}

// ── Feature Card ─────────────────────────────────────────────────────────
function FeatureCard({ f, index }: { f: Feature; index: number }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });

  return (
    <motion.div
      ref={ref}
      className="feature-card"
      initial={{ opacity: 0, y: 40, scale: 0.95 }}
      animate={inView ? { opacity: 1, y: 0, scale: 1 } : {}}
      transition={{
        duration: 0.55,
        delay: (index % 3) * 0.1,
        ease: [0.16, 1, 0.3, 1],
      }}
    >
      <motion.div
        className="feature-card-icon"
        style={{ background: f.color }}
        whileHover={{ scale: 1.15, rotate: [0, -8, 8, 0] }}
        transition={{ duration: 0.3 }}
      >
        {f.icon}
      </motion.div>
      <h3>{f.title}</h3>
      <p>{f.description}</p>
      <motion.div
        className="feature-card-arrow"
        initial={{ opacity: 0, x: -10 }}
        whileHover={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.2 }}
      >
        <ArrowRight size={14} />
      </motion.div>
    </motion.div>
  );
}

// ── Feature data ─────────────────────────────────────────────────────────
const features: Feature[] = [
  {
    icon: <Bot size={22} color="#6366f1" />,
    color: 'rgba(99,102,241,0.12)',
    title: 'Agents',
    description:
      'Configure personality, system prompt, tools, and MCP server connections per agent.',
  },
  {
    icon: <MessageSquare size={22} color="#8b5cf6" />,
    color: 'rgba(139,92,246,0.12)',
    title: 'Sessions',
    description:
      'Conversational memory per session. Pick up where you left off — history is preserved.',
  },
  {
    icon: <ListTodo size={22} color="#22c55e" />,
    color: 'rgba(34,197,94,0.12)',
    title: 'Tasks',
    description:
      'Structured task pipeline with async runs, streaming output, and step-by-step visibility.',
  },
  {
    icon: <Plug size={22} color="#f59e0b" />,
    color: 'rgba(245,158,11,0.12)',
    title: 'Channels',
    description:
      'Connect to Slack, Discord, Telegram, and more — bring AI to where your team works.',
  },
  {
    icon: <BookOpen size={22} color="#ec4899" />,
    color: 'rgba(236,72,153,0.12)',
    title: 'Skills',
    description:
      'Reusable skill modules that extend agent capabilities — load from the registry or author your own.',
  },
  {
    icon: <Cpu size={22} color="#06b6d4" />,
    color: 'rgba(6,182,212,0.12)',
    title: 'MCP Servers',
    description:
      'Model Context Protocol integration. Connect any MCP-compatible tool or data source.',
  },
];

const integrations = [
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

export default function Home() {
  const heroRef = useRef(null);
  const [typeStarted, setTypeStarted] = useState(false);
  const [bannerLoaded, setBannerLoaded] = useState(false);

  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ['start start', 'end start'],
  });
  const heroOpacity = useTransform(scrollYProgress, [0, 0.7], [1, 0]);
  const heroScale = useTransform(scrollYProgress, [0, 0.7], [1, 0.93]);
  const bannerY = useTransform(scrollYProgress, [0, 1], ['0%', '28%']);

  useEffect(() => {
    const t = setTimeout(() => setTypeStarted(true), 1800);
    return () => clearTimeout(t);
  }, []);

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
          transition={{ duration: 0.6, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
        >
          <Zap size={11} />
          Open Source · Self-hosted · Extensible
        </motion.div>

        <motion.h1
          className="hero-title"
          initial={{ opacity: 0, y: 35 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.35, ease: [0.16, 1, 0.3, 1] }}
        >
          Build agents that{' '}
          <span className="gradient-text">
            <TypewriterText text="actually do the work" start={typeStarted} />
          </span>
        </motion.h1>

        <motion.p
          className="hero-subtitle"
          initial={{ opacity: 0, y: 25 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.7, ease: 'easeOut' }}
        >
          OpenAidy is an open-source AI agent platform with structured tasks,
          conversational memory, multi-channel integrations, and a plugin system
          that grows with you.
        </motion.p>

        <motion.div
          className="hero-actions"
          initial={{ opacity: 0, y: 25 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.9, ease: 'easeOut' }}
        >
          <MagneticButton href="#features" className="btn-primary">
            Explore features
          </MagneticButton>
          <MagneticButton href="/docs" className="btn-secondary">
            <BookOpen size={15} />
            Read the docs
          </MagneticButton>
        </motion.div>

        <motion.div
          className="hero-banner"
          style={{ y: bannerY }}
          initial={{ opacity: 0, y: 70, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.9, delay: 1.3, ease: [0.16, 1, 0.3, 1] }}
        >
          <img
            src="/banner.png"
            alt="OpenAidy platform"
            onLoad={() => setBannerLoaded(true)}
            style={{
              opacity: bannerLoaded ? 1 : 0,
              transition: 'opacity 0.4s',
            }}
          />
          <div className="banner-glow" />
        </motion.div>
      </motion.section>

      {/* ── Marquee ──────────────────────────────────────────────────── */}
      <section className="marquee-section">
        <Marquee speed={35}>
          {integrations.map((name, i) => (
            <span key={i} className="marquee-item">
              <span className="marquee-dot" />
              {name}
            </span>
          ))}
        </Marquee>
      </section>

      {/* ── Features ─────────────────────────────────────────────────── */}
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
            <FeatureCard key={f.title} f={f} index={i} />
          ))}
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────────── */}
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
        <MagneticButton
          href="https://github.com/imzodev/openaidy"
          className="btn-primary btn-large"
        >
          <Github size={18} />
          View on GitHub
        </MagneticButton>
      </motion.section>
    </>
  );
}
