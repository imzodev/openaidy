import { motion } from 'framer-motion';
import { Github, BookOpen } from 'lucide-react';

export default function Navbar() {
  return (
    <motion.nav
      className="navbar"
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="navbar-logo">
        Open<span>Aidy</span>
      </div>
      <div className="navbar-links">
        <a href="/docs">
          <BookOpen
            size={14}
            style={{
              display: 'inline',
              marginRight: 4,
              verticalAlign: 'middle',
            }}
          />
          Docs
        </a>
        <a
          href="https://github.com/imzodev/openaidy"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Github
            size={14}
            style={{
              display: 'inline',
              marginRight: 4,
              verticalAlign: 'middle',
            }}
          />
          GitHub
        </a>
      </div>
    </motion.nav>
  );
}
