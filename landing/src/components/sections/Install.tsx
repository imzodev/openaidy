import { ChevronRight } from 'lucide-react';
import { InstallCommand, Reveal } from '../ui';

const GITHUB_URL = 'https://github.com/imzodev/aidy';

export function Install() {
  return (
    <section className="section install-section" id="install">
      <div className="section-inner">
        <Reveal className="section-head--center">
          <img
            src="/brand/mark.svg"
            alt=""
            width={72}
            height={72}
            className="install-mark"
          />
          <h2 className="section-title">Get Aidy.</h2>
          <p className="section-lede">
            One command installs the latest release from npm, sets up Node if
            needed, and opens Aidy in your browser.
          </p>
        </Reveal>

        <Reveal delay={0.1} className="install-box">
          <InstallCommand />
          <p className="install-note">
            Then run <code>aidy start</code>, <code>aidy stop</code> or{' '}
            <code>aidy status</code>. On a Linux server,{' '}
            <code>aidy service install</code> keeps it running.
          </p>
        </Reveal>

        <Reveal delay={0.16} className="install-links">
          <a
            href={`${GITHUB_URL}/releases/latest`}
            target="_blank"
            rel="noopener noreferrer"
            className="link-chevron"
          >
            Download the desktop app <ChevronRight size={16} />
          </a>
          <a href="/docs" className="link-chevron">
            Read the docs <ChevronRight size={16} />
          </a>
        </Reveal>
      </div>
    </section>
  );
}
