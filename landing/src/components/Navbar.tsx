import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import { useTheme } from './theme-context';
import {
  Github,
  BookOpen,
  BookMarked,
  Sun,
  Moon,
  BookText,
  Menu,
  X,
} from 'lucide-react';

export default function Navbar() {
  const { theme, setTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  const closeMobile = () => setMobileOpen(false);

  return (
    <>
      <motion.nav
        className="navbar"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <Link to="/" className="navbar-logo" onClick={closeMobile}>
          Open<span>Aidy</span>
        </Link>

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
          <Link to="/docs" className="navbar-link">
            <BookOpen
              size={14}
              style={{
                display: 'inline',
                marginRight: 4,
                verticalAlign: 'middle',
              }}
            />
            Docs
          </Link>
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

          <button
            onClick={toggleTheme}
            className="navbar-theme-btn"
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>

          <button
            onClick={() => setMobileOpen((o) => !o)}
            className="navbar-hamburger"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </motion.nav>

      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            className="mobile-menu"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            <Link to="/tutorials" className="mobile-link" onClick={closeMobile}>
              <BookMarked size={16} />
              Tutorials
            </Link>
            <Link to="/blog" className="mobile-link" onClick={closeMobile}>
              <BookText size={16} />
              Blog
            </Link>
            <Link to="/docs" className="mobile-link" onClick={closeMobile}>
              <BookOpen size={16} />
              Docs
            </Link>
            <a
              href="https://github.com/imzodev/openaidy"
              target="_blank"
              rel="noopener noreferrer"
              className="mobile-link"
              onClick={closeMobile}
            >
              <Github size={16} />
              GitHub
            </a>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
