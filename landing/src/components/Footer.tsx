import { motion } from 'framer-motion';

export default function Footer() {
  return (
    <motion.footer
      className="footer"
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6 }}
    >
      <p>
        OpenAidy · Open source ·{' '}
        <a
          href="https://github.com/imzodev/openaidy"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub
        </a>{' '}
        · <a href="/docs">Documentation</a>
      </p>
    </motion.footer>
  );
}
