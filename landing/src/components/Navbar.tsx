import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { useTheme } from 'next-themes';
import {
  Github,
  BookOpen,
  BookMarked,
  Sun,
  Moon,
  BookText,
} from 'lucide-react';
import { useEffect, useState } from 'react';

export default function Navbar() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

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
        <Link to="/tutorials" className="navbar-link">
          <BookMarked
            size={14}
            style={{
              display: 'inline',
              marginRight: 4,
              verticalAlign: 'middle',
            }}
          />
          Tutorials
        </Link>
        <Link to="/blog" className="navbar-link">
          <BookText
            size={14}
            style={{
              display: 'inline',
              marginRight: 4,
              verticalAlign: 'middle',
            }}
          />
          Blog
        </Link>
        <a href="/docs" className="navbar-link">
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
          className="navbar-link"
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

        {mounted && (
          <button
            onClick={toggleTheme}
            className="navbar-theme-btn"
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        )}
      </div>
    </motion.nav>
  );
}
