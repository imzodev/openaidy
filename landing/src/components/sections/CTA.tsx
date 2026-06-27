import { motion } from 'framer-motion';
import { Github } from 'lucide-react';
import { MagneticButton } from '../ui';

export function CTA() {
  return (
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
  );
}
