import { motion, useReducedMotion } from 'framer-motion';
import { ChevronRight, Github } from 'lucide-react';
import { ProductShot } from './ProductShot';

const ease = [0.25, 0.1, 0.25, 1] as const;

export function Hero() {
  const reduce = useReducedMotion();
  const enter = (delay: number) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 20 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.8, delay, ease },
        };

  return (
    <section className="hero">
      <motion.p className="hero-eyebrow" {...enter(0.05)}>
        Aidy
      </motion.p>
      <motion.h1 className="hero-title" {...enter(0.12)}>
        Your AI team.
        <br />
        <span className="gradient-text">On your terms.</span>
      </motion.h1>
      <motion.p className="hero-subtitle" {...enter(0.22)}>
        Always-on agents that do the work, learn how you like it, and reach you
        on WhatsApp. Self-hosted, open source, any model.
      </motion.p>
      <motion.div className="hero-actions" {...enter(0.32)}>
        <a href="#install" className="btn-primary">
          Install Aidy
        </a>
        <a
          href="https://github.com/imzodev/aidy"
          target="_blank"
          rel="noopener noreferrer"
          className="link-chevron"
        >
          <Github size={16} style={{ marginRight: 4 }} />
          View on GitHub
          <ChevronRight size={16} />
        </a>
      </motion.div>

      <motion.div
        className="hero-shot"
        {...(reduce
          ? {}
          : {
              initial: { opacity: 0, y: 48, scale: 0.98 },
              animate: { opacity: 1, y: 0, scale: 1 },
              transition: { duration: 1.1, delay: 0.45, ease },
            })}
      >
        <ProductShot />
      </motion.div>
    </section>
  );
}
