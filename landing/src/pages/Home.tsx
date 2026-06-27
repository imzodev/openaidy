import { useEffect, useRef, useState } from 'react';
import {
  motion,
  AnimatePresence,
  useMotionValue,
  useTransform,
  useScroll,
} from 'framer-motion';
import { BookOpen, Github, Terminal, Check } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────

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

// ── Integrations (marquee) ─────────────────────────────────────────────────
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

const chapterData = [
  {
    tag: 'Agents',
    title: 'Configure your agents',
    description:
      'Define personality, system prompts, and the tools each agent can reach. One agent for code review, another for ops, another for research — each tuned for its job.',
  },
  {
    tag: 'Channels',
    title: 'Connect every channel',
    description:
      'Bring agents into Slack, Discord, Telegram, and WhatsApp. Same agent, every surface — no rebuilding per channel.',
  },
  {
    tag: 'Skills & MCP',
    title: 'Extend with skills & MCP',
    description:
      'Pull reusable skill modules from the registry or author your own. Wire up any MCP-compatible tool or data source — no custom glue code.',
  },
  {
    tag: 'Tasks',
    title: 'Track work, ship faster',
    description:
      'Tasks flow through a kanban pipeline. Sessions preserve context across every conversation — pick up where you left off.',
  },
];

export default function Home() {
  const heroRef = useRef(null);
  const storyRef = useRef<HTMLDivElement>(null);
  const [typeStarted, setTypeStarted] = useState(false);
  const [bannerLoaded, setBannerLoaded] = useState(false);
  const [installTab, setInstallTab] = useState<'windows' | 'unix'>('windows');
  const [copied, setCopied] = useState(false);
  const [activeChapter, setActiveChapter] = useState(0);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

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
            {/* Vertical step indicator (desktop only) */}
            {!isMobile && (
              <div className="story-stepper" aria-hidden="true">
                <div className="story-step-line" />
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className={`story-step-dot ${activeChapter >= i ? 'story-step-dot--filled' : ''} ${activeChapter === i ? 'story-step-dot--active' : ''}`}
                  />
                ))}
              </div>
            )}

            {/* Desktop: render all 4 chapters stacked (each fades in/out) */}
            {!isMobile &&
              chapterData.map((ch, i) => (
                <motion.div
                  key={i}
                  className={`story-chapter ${activeChapter === i ? 'story-chapter--active' : ''}`}
                  animate={{ opacity: activeChapter === i ? 1 : 0.3 }}
                  transition={{ duration: 0.5 }}
                >
                  <span className="story-step">{ch.tag}</span>
                  <h3>{ch.title}</h3>
                  <p>{ch.description}</p>
                </motion.div>
              ))}

            {/* Mobile: render only the active chapter (sticky in same spot) */}
            {isMobile && (
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeChapter}
                  className="story-chapter story-chapter--active"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.35 }}
                >
                  <span className="story-step">
                    {chapterData[activeChapter].tag}
                  </span>
                  <h3>{chapterData[activeChapter].title}</h3>
                  <p>{chapterData[activeChapter].description}</p>
                </motion.div>
              </AnimatePresence>
            )}
          </div>

          {/* TWO sticky panels side-by-side, no transforms */}
          <div className="story-sticky">
            <div className="story-panel story-panel--chat">
              <div className="story-panel-header">
                <span>
                  {activeChapter === 0 && 'Agents'}
                  {activeChapter === 1 && 'Channels'}
                  {activeChapter === 2 && 'Skills & MCP'}
                  {activeChapter === 3 && 'Tasks'}
                </span>
              </div>
              <div className="story-panel-body">
                {/* Chapter 0 — Agents */}
                {activeChapter === 0 && (
                  <>
                    <div className="chat-msg chat-msg--user">
                      <span className="chat-avatar chat-avatar--user">L</span>
                      <div>
                        <div className="chat-meta">@lina · 9:02 AM</div>
                        <div className="chat-text">
                          Need an agent that only knows about billing —
                          shouldn't touch deploy or DB schema.
                        </div>
                      </div>
                    </div>
                    <div className="chat-msg chat-msg--agent">
                      <span className="chat-avatar chat-avatar--agent">A</span>
                      <div>
                        <div className="chat-meta">admin · 9:02 AM</div>
                        <div className="chat-text">
                          Created <code>billing-bot</code> — scoped tools,
                          isolated skills, no MCP.
                        </div>
                        <div className="chat-status">
                          <span className="chat-check">✓</span> Agent
                          registered, scope verified
                        </div>
                      </div>
                    </div>
                    <div className="chat-msg chat-msg--agent">
                      <span className="chat-avatar chat-avatar--agent">A</span>
                      <div>
                        <div className="chat-status chat-status--live">
                          <span className="chat-dot" /> Assigning billing-bot to
                          #billing
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {/* Chapter 1 — Channels */}
                {activeChapter === 1 && (
                  <>
                    <div className="chat-msg chat-msg--user">
                      <span className="chat-avatar chat-avatar--user">K</span>
                      <div>
                        <div className="chat-meta">@kira · 11:30 AM</div>
                        <div className="chat-text">
                          /connect telegram @openaidy_bot
                        </div>
                      </div>
                    </div>
                    <div className="chat-msg chat-msg--agent">
                      <span className="chat-avatar chat-avatar--agent">O</span>
                      <div>
                        <div className="chat-meta">openaidy · 11:30 AM</div>
                        <div className="chat-text">
                          Connecting Telegram… exchange complete. Bot authorized
                          for DMs and group mentions.
                        </div>
                        <div className="chat-status">
                          <span className="chat-check">✓</span> 3 channels
                          active · 0 errors
                        </div>
                      </div>
                    </div>
                    <div className="chat-msg chat-msg--agent">
                      <span className="chat-avatar chat-avatar--agent">O</span>
                      <div>
                        <div className="chat-status chat-status--live">
                          <span className="chat-dot" /> Syncing conversation
                          history with first session
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {/* Chapter 2 — Skills & MCP */}
                {activeChapter === 2 && (
                  <>
                    <div className="chat-msg chat-msg--user">
                      <span className="chat-avatar chat-avatar--user">D</span>
                      <div>
                        <div className="chat-meta">@dario · 4:18 PM</div>
                        <div className="chat-text">
                          Support needs to query our internal docs. Can the kb
                          MCP be wired in?
                        </div>
                      </div>
                    </div>
                    <div className="chat-msg chat-msg--agent">
                      <span className="chat-avatar chat-avatar--agent">S</span>
                      <div>
                        <div className="chat-meta">support · 4:18 PM</div>
                        <div className="chat-text">
                          Added <code>kb-mcp</code> server and loaded the{' '}
                          <code>faq</code> skill. Ready to answer.
                        </div>
                        <div className="chat-status">
                          <span className="chat-check">✓</span> MCP connected ·
                          42 docs indexed
                        </div>
                      </div>
                    </div>
                    <div className="chat-msg chat-msg--agent">
                      <span className="chat-avatar chat-avatar--agent">S</span>
                      <div>
                        <div className="chat-status chat-status--live">
                          <span className="chat-dot" /> Running skill:{' '}
                          <em>faq</em>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {/* Chapter 3 — Tasks & Sessions */}
                {activeChapter === 3 && (
                  <>
                    <div className="chat-msg chat-msg--user">
                      <span className="chat-avatar chat-avatar--user">M</span>
                      <div>
                        <div className="chat-meta">@marco · 2:14 PM</div>
                        <div className="chat-text">
                          Same auth bug from yesterday — push it back to the
                          coder agent and keep the session.
                        </div>
                      </div>
                    </div>
                    <div className="chat-msg chat-msg--agent">
                      <span className="chat-avatar chat-avatar--agent">C</span>
                      <div>
                        <div className="chat-meta">coder · 2:14 PM</div>
                        <div className="chat-text">
                          Resuming session <code>#auth-fix-42</code>. I remember
                          the rate-limit context from earlier.
                        </div>
                        <div className="chat-status">
                          <span className="chat-check">✓</span> Task moved In
                          progress · context loaded
                        </div>
                      </div>
                    </div>
                    <div className="chat-msg chat-msg--agent">
                      <span className="chat-avatar chat-avatar--agent">C</span>
                      <div>
                        <div className="chat-status chat-status--live">
                          <span className="chat-dot" /> Streaming step-by-step
                          output
                        </div>
                      </div>
                    </div>
                  </>
                )}

                <div className="chat-input">
                  <span>
                    {activeChapter === 0 && 'Send to admin…'}
                    {activeChapter === 1 && 'Send to openaidy…'}
                    {activeChapter === 2 && 'Send to support…'}
                    {activeChapter === 3 && 'Send to coder…'}
                  </span>
                  <span className="chat-input-arrow">→</span>
                </div>
              </div>
            </div>

            <div className="story-panel story-panel--workspace">
              <div className="story-panel-header">
                <span>
                  {activeChapter === 0 && 'Agent Registry'}
                  {activeChapter === 1 && 'Channels'}
                  {activeChapter === 2 && 'Skills Registry'}
                  {activeChapter === 3 && 'Task Pipeline'}
                </span>
              </div>
              <div className="story-tabs">
                <span
                  className={`story-tab ${activeChapter === 0 ? 'story-tab--active' : ''}`}
                >
                  ⚙ Agents
                </span>
                <span
                  className={`story-tab ${activeChapter === 1 ? 'story-tab--active' : ''}`}
                >
                  ⌁ Channels
                </span>
                <span
                  className={`story-tab ${activeChapter === 2 ? 'story-tab--active' : ''}`}
                >
                  ✦ Skills
                </span>
                <span
                  className={`story-tab ${activeChapter === 3 ? 'story-tab--active' : ''}`}
                >
                  ▤ Tasks
                </span>
              </div>
              <div className="story-panel-body">
                {activeChapter === 0 && (
                  <div className="mock-agents-list">
                    <div className="agent-row">
                      <div className="agent-avatar agent-avatar--blue">C</div>
                      <div className="agent-info">
                        <div className="agent-name">coder</div>
                        <div className="agent-meta">
                          gpt-4o · 4 tools · 2 MCP
                        </div>
                      </div>
                      <div className="agent-status agent-status--active" />
                    </div>
                    <div className="agent-row agent-row--active">
                      <div className="agent-avatar agent-avatar--purple">R</div>
                      <div className="agent-info">
                        <div className="agent-name">reviewer</div>
                        <div className="agent-meta">
                          claude-4 · 3 tools · skill: code-review
                        </div>
                      </div>
                      <div className="agent-status agent-status--active" />
                    </div>
                    <div className="agent-row">
                      <div className="agent-avatar agent-avatar--pink">O</div>
                      <div className="agent-info">
                        <div className="agent-name">ops</div>
                        <div className="agent-meta">
                          gpt-4o · 6 tools · shell + kubectl
                        </div>
                      </div>
                      <div className="agent-status agent-status--idle" />
                    </div>
                    <div className="agent-row">
                      <div className="agent-avatar agent-avatar--cyan">S</div>
                      <div className="agent-info">
                        <div className="agent-name">support</div>
                        <div className="agent-meta">
                          claude-4 · 2 tools · kb MCP
                        </div>
                      </div>
                      <div className="agent-status agent-status--idle" />
                    </div>
                  </div>
                )}
                {activeChapter === 1 && (
                  <div className="mock-channels">
                    <div className="channel-row channel-row--connected">
                      <div className="channel-icon channel-icon--slack">#</div>
                      <div className="channel-info">
                        <div className="channel-name">Slack · #dev</div>
                        <div className="channel-meta">
                          Connected · mentions trigger reviewer
                        </div>
                      </div>
                      <div className="channel-state channel-state--on" />
                    </div>
                    <div className="channel-row channel-row--connected">
                      <div className="channel-icon channel-icon--discord">
                        D
                      </div>
                      <div className="channel-info">
                        <div className="channel-name">Discord · /commands</div>
                        <div className="channel-meta">
                          Connected · slash commands
                        </div>
                      </div>
                      <div className="channel-state channel-state--on" />
                    </div>
                    <div className="channel-row channel-row--connected">
                      <div className="channel-icon channel-icon--telegram">
                        T
                      </div>
                      <div className="channel-info">
                        <div className="channel-name">
                          Telegram · @openaidy_bot
                        </div>
                        <div className="channel-meta">
                          Connected · DMs + groups
                        </div>
                      </div>
                      <div className="channel-state channel-state--on" />
                    </div>
                    <div className="channel-row">
                      <div className="channel-icon channel-icon--whatsapp">
                        W
                      </div>
                      <div className="channel-info">
                        <div className="channel-name">
                          WhatsApp · not connected
                        </div>
                        <div className="channel-meta">Tap to connect</div>
                      </div>
                      <div className="channel-state channel-state--off" />
                    </div>
                  </div>
                )}
                {activeChapter === 2 && (
                  <div className="mock-skills">
                    <div className="skill-row skill-row--active">
                      <div className="skill-icon skill-icon--green">✓</div>
                      <div className="skill-info">
                        <div className="skill-name">code-review</div>
                        <div className="skill-meta">
                          v2.1.0 · openaidy · loaded on reviewer
                        </div>
                      </div>
                    </div>
                    <div className="skill-row skill-row--active">
                      <div className="skill-icon skill-icon--green">✓</div>
                      <div className="skill-info">
                        <div className="skill-name">github-pr</div>
                        <div className="skill-meta">
                          v1.4.2 · openaidy · MCP
                        </div>
                      </div>
                    </div>
                    <div className="skill-row skill-row--active">
                      <div className="skill-icon skill-icon--green">✓</div>
                      <div className="skill-info">
                        <div className="skill-name">kubectl-ops</div>
                        <div className="skill-meta">
                          v0.9.0 · community · loaded on ops
                        </div>
                      </div>
                    </div>
                    <div className="skill-row">
                      <div className="skill-icon skill-icon--add">+</div>
                      <div className="skill-info">
                        <div className="skill-name">Add from registry</div>
                        <div className="skill-meta">42 skills available</div>
                      </div>
                    </div>
                  </div>
                )}
                {activeChapter === 3 && (
                  <div className="mock-kanban-mini">
                    <div className="mini-col">
                      <div className="mini-col-header">Backlog</div>
                      <div className="mini-card">
                        <div className="mini-bar" style={{ width: '70%' }} />
                      </div>
                      <div className="mini-card">
                        <div className="mini-bar" style={{ width: '55%' }} />
                      </div>
                    </div>
                    <div className="mini-col">
                      <div className="mini-col-header">In progress</div>
                      <div className="mini-card mini-card--active">
                        <div className="mini-bar" style={{ width: '85%' }} />
                        <div className="mini-tag">reviewer</div>
                      </div>
                    </div>
                    <div className="mini-col">
                      <div className="mini-col-header">Done</div>
                      <div className="mini-card">
                        <div className="mini-bar" style={{ width: '60%' }} />
                      </div>
                      <div className="mini-card">
                        <div className="mini-bar" style={{ width: '75%' }} />
                      </div>
                      <div className="mini-card">
                        <div className="mini-bar" style={{ width: '50%' }} />
                      </div>
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
