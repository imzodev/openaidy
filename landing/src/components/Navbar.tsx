import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link, NavLink } from 'react-router-dom';
import { useTheme } from './theme-context';
import { Sun, Moon, Menu, X } from 'lucide-react';
import { BrandLogo } from './BrandLogo';

const LINKS = [
  { to: '/docs', label: 'Docs' },
  { to: '/tutorials', label: 'Tutorials' },
  { to: '/blog', label: 'Blog' },
] as const;

const GITHUB_URL = 'https://github.com/imzodev/aidy';

export default function Navbar() {
  const { theme, setTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark');
  const closeMobile = () => setMobileOpen(false);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  return (
    <>
      <nav className="navbar" aria-label="Main">
        <div className="navbar-inner">
          <Link to="/" className="navbar-logo" onClick={closeMobile}>
            <BrandLogo size={22} />
          </Link>

          <div className="navbar-links">
            {LINKS.map((l) => (
              <NavLink key={l.to} to={l.to} className="navbar-link">
                {l.label}
              </NavLink>
            ))}
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="navbar-link"
            >
              GitHub
            </a>
          </div>

          <div className="navbar-actions">
            <button
              onClick={toggleTheme}
              className="navbar-icon-btn"
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <a href="/#install" className="navbar-cta">
              Install
            </a>
            <button
              onClick={() => setMobileOpen((o) => !o)}
              className="navbar-icon-btn navbar-hamburger"
              aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileOpen}
            >
              {mobileOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>
      </nav>

      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            className="mobile-menu"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
          >
            {LINKS.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className="mobile-link"
                onClick={closeMobile}
              >
                {l.label}
              </Link>
            ))}
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mobile-link"
              onClick={closeMobile}
            >
              GitHub
            </a>
            <a
              href="/#install"
              className="mobile-link mobile-link--accent"
              onClick={closeMobile}
            >
              Install Aidy
            </a>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
