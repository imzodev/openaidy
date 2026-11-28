import { Link } from 'react-router-dom';
import { BrandLogo } from './BrandLogo';

const GITHUB_URL = 'https://github.com/imzodev/aidy';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-top">
          <BrandLogo size={20} />
          <nav className="footer-links" aria-label="Footer">
            <Link to="/docs">Docs</Link>
            <Link to="/tutorials">Tutorials</Link>
            <Link to="/blog">Blog</Link>
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
            <a
              href="https://www.npmjs.com/package/@aidyagent/app"
              target="_blank"
              rel="noopener noreferrer"
            >
              npm
            </a>
            <a
              href={`${GITHUB_URL}/releases/latest`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Desktop app
            </a>
          </nav>
        </div>
        <p className="footer-legal">
          Aidy is open source and self-hosted: your agents, your data, your
          server.
        </p>
      </div>
    </footer>
  );
}
