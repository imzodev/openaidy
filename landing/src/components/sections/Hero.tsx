import { useEffect, useRef, useState } from 'react';
import { motion, useTransform, useScroll } from 'framer-motion';
import { BookOpen, Terminal, Check } from 'lucide-react';
import { TypewriterText, MagneticButton } from '../ui';

const INSTALL_COMMANDS = {
  windows: 'iex (irm https://openaidy.com/install.ps1)',
  unix: 'curl -fsSL https://openaidy.com/install.sh | bash',
} as const;

export function Hero() {
  const heroRef = useRef(null);
  const [typeStarted, setTypeStarted] = useState(false);
  const [bannerLoaded, setBannerLoaded] = useState(false);
  const [installTab, setInstallTab] = useState<'windows' | 'unix'>('windows');
  const [copied, setCopied] = useState(false);

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

  const handleCopy = async () => {
    await navigator.clipboard.writeText(INSTALL_COMMANDS[installTab]);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
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
          <code>{INSTALL_COMMANDS[installTab]}</code>
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
  );
}
