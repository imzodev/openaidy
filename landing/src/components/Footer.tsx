import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <motion.footer
      className="footer"
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6 }}
    >
      <div className="footer-links">
        <Link to="/tutorials">Tutorials</Link>
        <Link to="/blog">Blog</Link>
        <a href="/docs">Documentation</a>
        <a
          href="https://github.com/imzodev/aidy"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub
        </a>
      </div>
      <p>
        Aidy · Open source ·{' '}
        <a
          href="https://github.com/imzodev/aidy"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub
        </a>
      </p>
    </motion.footer>
  );
}
