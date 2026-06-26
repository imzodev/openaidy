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
  Github,
  Terminal,
  Check,
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
  const storyRef = useRef<HTMLDivElement>(null);
  const [typeStarted, setTypeStarted] = useState(false);
  const [bannerLoaded, setBannerLoaded] = useState(false);
  const [installTab, setInstallTab] = useState<'windows' | 'unix'>('windows');
  const [copied, setCopied] = useState(false);
  const [activeChapter, setActiveChapter] = useState(0);

  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ['start start', 'end start'],
  });
  const heroOpacity = useTransform(scrollYProgress, [0, 0.7], [1, 0]);
  const heroScale = useTransform(scrollYProgress, [0, 0.7], [1, 0.93]);
  const bannerY = useTransform(scrollYProgress, [0, 1], ['0%', '28%']);

  const storyProgress = useScroll({
    target: storyRef,
    offset: ['start start', 'end end'],
  }).scrollYProgress;

  const chapterIndex = useTransform(
    storyProgress,
    [0, 0.25, 0.5, 0.75, 1],
    [0, 1, 2, 3, 3],
  );

  useEffect(() => {
    return chapterIndex.on('change', (v) => {
      setActiveChapter(Math.round(v));
    });
  }, [chapterIndex]);

  useEffect(() => {
    const t = setTimeout(() => setTypeStarted(true), 1800);
    return () => clearTimeout(t);
  }, []);

  const installCommands = {
    windows: 'iex (irm https://openaidy.com/install.ps1)',
    unix: 'curl -fsSL https://openaidy.com/install.sh | bash',
  };

  const handleCopy = async () => {
    const cmd = installCommands[installTab];
    await navigator.clipboard.writeText(cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <FloatingOrbs />

      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <motion.section
        ref={heroRef}
        className="hero"
        style={{ opacity: heroOpacity, scale: heroScale }}
      >
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
          Build AI agents that remember, connect everywhere, and extend with
          plugins. Self-hosted and open-source.
        </motion.p>

        {/* ── Install command ─────────────────────────────────────────── */}
        <motion.div
          className="hero-install"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 1.1, ease: 'easeOut' }}
        >
          <div className="hero-install-tabs">
            <button
              className={`hero-install-tab ${installTab === 'windows' ? 'hero-install-tab--active' : ''}`}
              onClick={() => setInstallTab('windows')}
            >
              Windows
            </button>
            <button
              className={`hero-install-tab ${installTab === 'unix' ? 'hero-install-tab--active' : ''}`}
              onClick={() => setInstallTab('unix')}
            >
              macOS / Linux
            </button>
          </div>
          <div className="hero-install-code">
            <Terminal size={14} className="hero-install-icon" />
            <code>{installCommands[installTab]}</code>
            <button
              className="hero-install-copy"
              onClick={handleCopy}
              aria-label="Copy to clipboard"
            >
              {copied ? <Check size={14} /> : 'Copy'}
            </button>
          </div>
          <p className="hero-install-note">
            Installs Git, Node.js, pnpm, and builds the project automatically.
          </p>
        </motion.div>
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

      {/* ── Sticky Scroll Story ──────────────────────────────────────────── */}
      <section className="story">
        <div className="story-header">
          <h2>Built to collaborate with you</h2>
          <p>
            From task to delivery — every step of an agent's workflow, in one
            workspace.
          </p>
        </div>

        <div ref={storyRef} className="story-container">
          <div className="story-text">
            {/* Vertical step indicator */}
            <div className="story-stepper" aria-hidden="true">
              <div className="story-step-line" />
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={`story-step-dot ${activeChapter >= i ? 'story-step-dot--filled' : ''} ${activeChapter === i ? 'story-step-dot--active' : ''}`}
                />
              ))}
            </div>

            <motion.div
              className={`story-chapter ${activeChapter === 0 ? 'story-chapter--active' : ''}`}
              animate={{ opacity: activeChapter === 0 ? 1 : 0.3 }}
              transition={{ duration: 0.5 }}
            >
              <span className="story-step">Step 01</span>
              <h3>Set up your next task</h3>
              <p>
                Drop a task into the kanban. OpenAidy picks it up, plans the
                work, and routes it to the right agent.
              </p>
            </motion.div>

            <motion.div
              className={`story-chapter ${activeChapter === 1 ? 'story-chapter--active' : ''}`}
              animate={{ opacity: activeChapter === 1 ? 1 : 0.3 }}
              transition={{ duration: 0.5 }}
            >
              <span className="story-step">Step 02</span>
              <h3>Plan and delegate</h3>
              <p>
                The planner breaks work into steps, selects tools, and shows you
                the approach before executing.
              </p>
            </motion.div>

            <motion.div
              className={`story-chapter ${activeChapter === 2 ? 'story-chapter--active' : ''}`}
              animate={{ opacity: activeChapter === 2 ? 1 : 0.3 }}
              transition={{ duration: 0.5 }}
            >
              <span className="story-step">Step 03</span>
              <h3>Run in a real shell</h3>
              <p>
                Agents execute commands in an isolated shell. Watch the terminal
                stream live, step by step.
              </p>
            </motion.div>

            <motion.div
              className={`story-chapter ${activeChapter === 3 ? 'story-chapter--active' : ''}`}
              animate={{ opacity: activeChapter === 3 ? 1 : 0.3 }}
              transition={{ duration: 0.5 }}
            >
              <span className="story-step">Step 04</span>
              <h3>Review and iterate</h3>
              <p>
                Session memory preserves full context. Continue the
                conversation, refine, ship.
              </p>
            </motion.div>
          </div>

          {/* TWO sticky panels side-by-side, no transforms */}
          <div className="story-sticky">
            <div className="story-panel story-panel--chat">
              <div className="story-panel-header">
                <span>Set up Next.js repo</span>
              </div>
              <div className="story-panel-body">
                <div className="chat-msg chat-msg--user">
                  <span className="chat-avatar chat-avatar--user">Y</span>
                  <div>
                    <div className="chat-meta">You · 5:05 PM</div>
                    <div className="chat-text">
                      Can you start by setting up the Next.js repo, building the
                      project, and running an example?
                    </div>
                  </div>
                </div>
                <div className="chat-msg chat-msg--agent">
                  <span className="chat-avatar chat-avatar--agent">A</span>
                  <div>
                    <div className="chat-meta">Agent · 5:05 PM</div>
                    <div className="chat-text">
                      Absolutely! I'll get started on that right away and keep
                      you updated on my progress.
                    </div>
                    <div className="chat-status">
                      <span className="chat-check">✓</span> Cloned repo from
                      GitHub.
                    </div>
                  </div>
                </div>
                <div className="chat-msg chat-msg--agent">
                  <span className="chat-avatar chat-avatar--agent">A</span>
                  <div>
                    <div className="chat-status chat-status--live">
                      <span className="chat-dot" /> Agent is setting up the
                      Next.js repo
                    </div>
                  </div>
                </div>
                <div className="chat-input">
                  <span>Give the agent a task to work on…</span>
                  <span className="chat-input-arrow">→</span>
                </div>
              </div>
            </div>

            <div className="story-panel story-panel--workspace">
              <div className="story-panel-header">
                <span>Agent's Workspace</span>
              </div>
              <div className="story-tabs">
                <span
                  className={`story-tab ${activeChapter >= 1 ? 'story-tab--active' : ''}`}
                >
                  ✦ Planner
                </span>
                <span
                  className={`story-tab ${activeChapter === 2 ? 'story-tab--active' : ''}`}
                >
                  ⌨ Shell
                </span>
                <span
                  className={`story-tab ${activeChapter === 3 ? 'story-tab--active' : ''}`}
                >
                  ✎ Editor
                </span>
                <span className="story-tab">⌁ Browser</span>
              </div>
              <div className="story-panel-body">
                {activeChapter === 0 && (
                  <div className="story-panel-empty">Waiting for task…</div>
                )}
                {activeChapter === 1 && (
                  <div className="mock-planner">
                    <div className="planner-task">
                      <div className="planner-task-name">
                        Initialize project structure
                      </div>
                      <div className="planner-task-status planner-task-status--done">
                        ✓
                      </div>
                    </div>
                    <div className="planner-task">
                      <div className="planner-task-name">
                        Install dependencies
                      </div>
                      <div className="planner-task-status planner-task-status--done">
                        ✓
                      </div>
                    </div>
                    <div className="planner-task planner-task--active">
                      <div className="planner-task-name">
                        Configure TypeScript & ESLint
                      </div>
                      <div className="planner-task-status planner-task-status--active">
                        ●
                      </div>
                    </div>
                    <div className="planner-task">
                      <div className="planner-task-name">
                        Set up routing structure
                      </div>
                      <div className="planner-task-status">○</div>
                    </div>
                    <div className="planner-task">
                      <div className="planner-task-name">
                        Add base components
                      </div>
                      <div className="planner-task-status">○</div>
                    </div>
                  </div>
                )}
                {activeChapter === 2 && (
                  <div className="mock-shell">
                    <div className="shell-line">
                      <span className="shell-prompt">$</span>{' '}
                      <span className="shell-cmd">
                        git clone https://github.com/vercel/next.js.git
                      </span>
                    </div>
                    <div className="shell-line shell-out">
                      Cloning into 'next.js'…
                    </div>
                    <div className="shell-line shell-out">
                      remote: Enumerating objects: 465785, done.
                    </div>
                    <div className="shell-line shell-out">
                      remote: Counting objects: 100% (1887/1887), done.
                    </div>
                    <div className="shell-line shell-out">
                      remote: Compressing objects: 100% (943/943), done.
                    </div>
                    <div className="shell-line shell-out">
                      Receiving objects: 100% (465785/465785), 1.96 GiB
                    </div>
                    <div className="shell-line shell-out">
                      Resolving deltas: 100% (321456/321456), done.
                    </div>
                    <div className="shell-line">
                      <span className="shell-prompt">$</span>{' '}
                      <span className="shell-cursor" />
                    </div>
                    <div className="shell-progress">
                      <div className="shell-progress-bar" />
                    </div>
                  </div>
                )}
                {activeChapter === 3 && (
                  <div className="mock-editor">
                    <div className="editor-line">
                      <span className="editor-ln">1</span>
                      <span>
                        <span className="ed-kw">import</span>{' '}
                        <span className="ed-var">rateLimit</span>{' '}
                        <span className="ed-kw">from</span>{' '}
                        <span className="ed-str">'express-rate-limit'</span>
                      </span>
                    </div>
                    <div className="editor-line">
                      <span className="editor-ln">2</span>
                      <span>&nbsp;</span>
                    </div>
                    <div className="editor-line">
                      <span className="editor-ln">3</span>
                      <span>
                        <span className="ed-kw">const</span>{' '}
                        <span className="ed-var">limiter</span>{' '}
                        <span className="ed-op">=</span>{' '}
                        <span className="ed-fn">rateLimit</span>(
                      </span>
                    </div>
                    <div className="editor-line">
                      <span className="editor-ln">4</span>
                      <span>
                        {'  '}
                        <span className="ed-attr">windowMs</span>:{' '}
                        <span className="ed-num">15 * 60 * 1000</span>,
                      </span>
                    </div>
                    <div className="editor-line">
                      <span className="editor-ln">5</span>
                      <span>
                        {'  '}
                        <span className="ed-attr">max</span>:{' '}
                        <span className="ed-num">100</span>,
                      </span>
                    </div>
                    <div className="editor-line">
                      <span className="editor-ln">6</span>
                      <span>)</span>
                    </div>
                    <div className="editor-line">
                      <span className="editor-ln">7</span>
                      <span>&nbsp;</span>
                    </div>
                    <div className="editor-line">
                      <span className="editor-ln">8</span>
                      <span>
                        <span className="ed-kw">export</span>{' '}
                        <span className="ed-kw">default</span>{' '}
                        <span className="ed-var">limiter</span>
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Product Showcase ──────────────────────────────────────────── */}
      <section className="showcase">
        <motion.div
          className="showcase-header"
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-50px' }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        >
          <h2>Built for real workflows</h2>
          <p>
            From task management to multi-agent orchestration — see OpenAidy in
            action.
          </p>
        </motion.div>

        <div className="showcase-grid">
          {/* Kanban Board */}
          <motion.div
            className="showcase-card"
            initial={{ opacity: 0, y: 60, rotateX: 8 }}
            whileInView={{ opacity: 1, y: 0, rotateX: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.7, delay: 0, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="showcase-screen">
              <div className="mock-window">
                <div className="mock-titlebar">
                  <div className="mock-dots">
                    <span />
                    <span />
                    <span />
                  </div>
                  <span className="mock-title">Tasks — Kanban</span>
                </div>
                <div className="mock-body mock-kanban">
                  <div className="kanban-col">
                    <div className="kanban-col-header">Backlog</div>
                    <div className="kanban-card" style={{ opacity: 0.5 }}>
                      <div className="kanban-bar" style={{ width: '70%' }} />
                      <div className="kanban-bar" style={{ width: '45%' }} />
                    </div>
                    <div className="kanban-card" style={{ opacity: 0.5 }}>
                      <div className="kanban-bar" style={{ width: '55%' }} />
                      <div className="kanban-bar" style={{ width: '80%' }} />
                    </div>
                  </div>
                  <div className="kanban-col">
                    <div className="kanban-col-header">In Progress</div>
                    <div className="kanban-card kanban-card--active">
                      <div className="kanban-bar" style={{ width: '65%' }} />
                      <div className="kanban-bar" style={{ width: '40%' }} />
                      <div className="kanban-tag">agent-1</div>
                    </div>
                    <div className="kanban-card" style={{ opacity: 0.5 }}>
                      <div className="kanban-bar" style={{ width: '50%' }} />
                    </div>
                  </div>
                  <div className="kanban-col">
                    <div className="kanban-col-header">Review</div>
                    <div className="kanban-card" style={{ opacity: 0.5 }}>
                      <div className="kanban-bar" style={{ width: '60%' }} />
                      <div className="kanban-bar" style={{ width: '35%' }} />
                    </div>
                  </div>
                  <div className="kanban-col">
                    <div className="kanban-col-header">Done</div>
                    <div className="kanban-card" style={{ opacity: 0.5 }}>
                      <div className="kanban-bar" style={{ width: '75%' }} />
                      <div className="kanban-bar" style={{ width: '30%' }} />
                    </div>
                    <div className="kanban-card" style={{ opacity: 0.5 }}>
                      <div className="kanban-bar" style={{ width: '55%' }} />
                    </div>
                    <div className="kanban-card" style={{ opacity: 0.5 }}>
                      <div className="kanban-bar" style={{ width: '65%' }} />
                      <div className="kanban-bar" style={{ width: '40%' }} />
                    </div>
                  </div>
                </div>
              </div>
              <div className="showcase-glow showcase-glow--green" />
            </div>
            <div className="showcase-label">
              <h3>Task Pipeline</h3>
              <p>
                Structured kanban with async runs and step-by-step visibility.
              </p>
            </div>
          </motion.div>

          {/* Agents */}
          <motion.div
            className="showcase-card"
            initial={{ opacity: 0, y: 60, rotateX: 8 }}
            whileInView={{ opacity: 1, y: 0, rotateX: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.7, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="showcase-screen">
              <div className="mock-window">
                <div className="mock-titlebar">
                  <div className="mock-dots">
                    <span />
                    <span />
                    <span />
                  </div>
                  <span className="mock-title">Agents</span>
                </div>
                <div className="mock-body mock-agents">
                  <div className="agent-row">
                    <div className="agent-avatar agent-avatar--blue">A</div>
                    <div className="agent-info">
                      <div className="agent-name">Coder</div>
                      <div className="agent-meta">
                        gpt-4o · 3 tools · active
                      </div>
                    </div>
                    <div className="agent-status agent-status--active" />
                  </div>
                  <div className="agent-row">
                    <div className="agent-avatar agent-avatar--purple">B</div>
                    <div className="agent-info">
                      <div className="agent-name">Reviewer</div>
                      <div className="agent-meta">
                        claude-4 · 2 tools · idle
                      </div>
                    </div>
                    <div className="agent-status agent-status--idle" />
                  </div>
                  <div className="agent-row">
                    <div className="agent-avatar agent-avatar--pink">C</div>
                    <div className="agent-info">
                      <div className="agent-name">DevOps</div>
                      <div className="agent-meta">
                        gpt-4o · 5 tools · active
                      </div>
                    </div>
                    <div className="agent-status agent-status--active" />
                  </div>
                  <div className="agent-row">
                    <div className="agent-avatar agent-avatar--cyan">D</div>
                    <div className="agent-info">
                      <div className="agent-name">Researcher</div>
                      <div className="agent-meta">
                        claude-4 · 4 tools · idle
                      </div>
                    </div>
                    <div className="agent-status agent-status--idle" />
                  </div>
                </div>
              </div>
              <div className="showcase-glow showcase-glow--purple" />
            </div>
            <div className="showcase-label">
              <h3>Agent Management</h3>
              <p>
                Configure personality, tools, and MCP connections per agent.
              </p>
            </div>
          </motion.div>

          {/* Sessions */}
          <motion.div
            className="showcase-card"
            initial={{ opacity: 0, y: 60, rotateX: 8 }}
            whileInView={{ opacity: 1, y: 0, rotateX: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.7, delay: 0.24, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="showcase-screen">
              <div className="mock-window">
                <div className="mock-titlebar">
                  <div className="mock-dots">
                    <span />
                    <span />
                    <span />
                  </div>
                  <span className="mock-title">Sessions</span>
                </div>
                <div className="mock-body mock-sessions">
                  <div className="session-item session-item--active">
                    <div className="session-dot session-dot--active" />
                    <div className="session-info">
                      <div className="session-name">
                        Fix auth middleware bug
                      </div>
                      <div className="session-time">
                        2 min ago · 14 messages
                      </div>
                    </div>
                  </div>
                  <div className="session-item">
                    <div className="session-dot" />
                    <div className="session-info">
                      <div className="session-name">Refactor user service</div>
                      <div className="session-time">
                        1 hour ago · 8 messages
                      </div>
                    </div>
                  </div>
                  <div className="session-item">
                    <div className="session-dot" />
                    <div className="session-info">
                      <div className="session-name">Deploy to staging</div>
                      <div className="session-time">
                        3 hours ago · 22 messages
                      </div>
                    </div>
                  </div>
                  <div className="session-item">
                    <div className="session-dot" />
                    <div className="session-info">
                      <div className="session-name">Write API docs</div>
                      <div className="session-time">Yesterday · 5 messages</div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="showcase-glow showcase-glow--pink" />
            </div>
            <div className="showcase-label">
              <h3>Session Memory</h3>
              <p>
                Conversational context preserved per session. Pick up where you
                left off.
              </p>
            </div>
          </motion.div>
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
