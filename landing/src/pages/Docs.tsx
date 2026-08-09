import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { marked } from 'marked';
import {
  BookOpen,
  ChevronRight,
  Menu,
  X,
  ArrowLeft,
  ArrowRight,
  Home,
} from 'lucide-react';
import { Helmet } from 'react-helmet-async';

// ── Sidebar structure ───────────────────────────────────────────────────────

interface DocEntry {
  title: string;
  slug?: string; // single page (leave children for section header)
  children?: DocEntry[]; // section
  href?: string; // external
}

const DOC_STRUCTURE: DocEntry[] = [
  {
    title: 'Getting Started',
    children: [{ title: 'Getting Started', slug: 'getting-started' }],
  },
  {
    title: 'Core Concepts',
    children: [
      { title: 'Agents', slug: 'agents' },
      { title: 'Sessions', slug: 'sessions' },
      { title: 'Providers', slug: 'providers' },
      { title: 'Memories', slug: 'memories' },
      { title: 'Skills', slug: 'skills' },
      { title: 'Creating Skills', slug: 'creating-skills' },
      { title: 'Workspace', slug: 'workspace' },
    ],
  },
  {
    title: 'Automation',
    children: [
      { title: 'Tasks', slug: 'tasks' },
      { title: 'Task Schedules', slug: 'task-schedules' },
      { title: 'Pulses', slug: 'pulses' },
    ],
  },
  {
    title: 'Connecting the Outside World',
    children: [
      { title: 'Channels', slug: 'channels' },
      { title: 'MCP Servers', slug: 'mcp-servers' },
      { title: 'Addons', slug: 'addons/README' },
      { title: 'Addon Permissions', slug: 'addons/addon-permissions' },
    ],
  },
  {
    title: 'Operating OpenAidy',
    children: [
      { title: 'Configuration', slug: 'config' },
      { title: 'Access Tokens & Device Pairing', slug: 'access-tokens' },
      { title: 'Usage', slug: 'usage' },
    ],
  },
  {
    title: 'CLI',
    children: [
      { title: 'Overview', slug: 'cli/README' },
      { title: 'Getting Started', slug: 'cli/getting-started' },
      { title: 'Installation', slug: 'cli/installation' },
      { title: 'Bootstrap Admin', slug: 'cli/bootstrap-admin' },
      { title: 'Command Reference', slug: 'cli/command-reference' },
    ],
  },
];

function flattenDocs(entries: DocEntry[]): { title: string; slug: string }[] {
  return entries.flatMap((e) =>
    e.children
      ? e.children.map((c) => ({ title: c.title, slug: c.slug ?? '' }))
      : [],
  );
}

function findAdjacent(slug: string): {
  prev?: { title: string; slug: string };
  next?: { title: string; slug: string };
} {
  const flat = flattenDocs(DOC_STRUCTURE);
  const idx = flat.findIndex((d) => d.slug === slug);
  return {
    prev: idx > 0 ? flat[idx - 1] : undefined,
    next: idx < flat.length - 1 ? flat[idx + 1] : undefined,
  };
}

// ── Markdown renderer ───────────────────────────────────────────────────────

function renderMarkdown(src: string): string {
  const renderer = new marked.Renderer();

  // Convert relative .md links to SPA routes
  renderer.link = ({ href, text }: { href: string; text: string }) => {
    if (href && !href.startsWith('http') && !href.startsWith('#')) {
      const normalized = href.replace(/\.md$/, '').replace(/^\.\//, '');
      return `<a href="/docs/${normalized}">${text}</a>`;
    }
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  };

  // Headings get anchor IDs
  renderer.heading = ({ text, depth }: { text: string; depth: number }) => {
    const id = text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-');
    return `<h${depth} id="${id}">${text}</h${depth}>`;
  };

  marked.setOptions({ renderer });
  return marked.parse(src) as string;
}

// ── Frontmatter parser (simple YAML-lite) ───────────────────────────────────

function parseFrontmatter(raw: string): {
  meta: Record<string, string>;
  body: string;
} {
  const meta: Record<string, string> = {};
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (fmMatch) {
    fmMatch[1].split('\n').forEach((line) => {
      const colon = line.indexOf(':');
      if (colon < 0) return;
      const key = line.slice(0, colon).trim();
      const val = line
        .slice(colon + 1)
        .trim()
        .replace(/^["']|["']$/g, '');
      meta[key] = val;
    });
    return { meta, body: fmMatch[2] };
  }
  return { meta, body: raw };
}

// The route-level page-transition animation remounts this component on every
// navigation (each doc slug is a distinct pathname). Without this, the
// sidebar's own scroll position resets to the top on every click.
let savedSidebarScrollTop = 0;

// ── Component ────────────────────────────────────────────────────────────────

export default function Docs() {
  const { '*': docSlug } = useParams<{ '*': string }>();
  const navigate = useNavigate();
  const slug = docSlug || 'index';
  const [content, setContent] = useState('');
  const [html, setHtml] = useState('');
  const [meta, setMeta] = useState<Record<string, string>>({});
  const [mobileOpen, setMobileOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);

  // Restore the sidebar's scroll position before paint, since this component
  // remounts fresh on every navigation (see savedSidebarScrollTop above).
  useLayoutEffect(() => {
    if (sidebarRef.current)
      sidebarRef.current.scrollTop = savedSidebarScrollTop;
  }, []);

  // A new doc should always open scrolled to its own top.
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [slug]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/docs/${slug}.md`)
      .then((r) => {
        if (!r.ok) throw new Error('not found');
        return r.text();
      })
      .then((raw) => {
        if (cancelled) return;
        const { meta: fm, body } = parseFrontmatter(raw);
        setMeta(fm);
        setContent(body);
        setHtml(renderMarkdown(body));
      })
      .catch(() => {
        // Fallback to index if not found
        if (!cancelled) navigate('/docs/index', { replace: true });
      });
    return () => {
      cancelled = true;
    };
  }, [slug, navigate]);

  const { prev, next } = findAdjacent(slug);
  const docTitle =
    meta.title || slug.split('/').pop()?.replace(/-/g, ' ') || 'Docs';

  return (
    <div className="docs-layout">
      <Helmet>
        <title>{docTitle} — OpenAidy Docs</title>
        <meta
          name="description"
          content={meta.summary || `${docTitle} — OpenAidy documentation`}
        />
        <meta property="og:title" content={`${docTitle} — OpenAidy Docs`} />
        <meta property="og:description" content={meta.summary || ''} />
      </Helmet>

      {/* Mobile header */}
      <div className="docs-mobile-header">
        <Link to="/" className="docs-logo">
          Open<span>Aidy</span>
        </Link>
        <button
          className="docs-mobile-menu-btn"
          onClick={() => setMobileOpen((o) => !o)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Sidebar overlay */}
      {mobileOpen && (
        <div className="docs-overlay" onClick={() => setMobileOpen(false)} />
      )}

      {/* Sidebar */}
      <aside
        ref={sidebarRef}
        className={`docs-sidebar ${mobileOpen ? 'docs-sidebar--open' : ''}`}
        onScroll={(e) => {
          savedSidebarScrollTop = e.currentTarget.scrollTop;
        }}
      >
        <div className="docs-sidebar-inner">
          <Link to="/docs" className="docs-sidebar-home">
            <Home size={14} />
            Docs home
          </Link>

          {DOC_STRUCTURE.map((section) => (
            <div key={section.title} className="docs-sidebar-section">
              <p className="docs-sidebar-heading">{section.title}</p>
              <ul className="docs-sidebar-list">
                {section.children?.map((child) => (
                  <li key={child.slug}>
                    <Link
                      to={`/docs/${child.slug}`}
                      className={`docs-sidebar-link ${slug === child.slug ? 'docs-sidebar-link--active' : ''}`}
                      onClick={() => setMobileOpen(false)}
                    >
                      {child.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </aside>

      {/* Main content */}
      <main className="docs-main">
        {content ? (
          <>
            {/* Breadcrumb */}
            <nav className="docs-breadcrumb">
              <Link to="/docs" className="docs-breadcrumb-link">
                <BookOpen size={13} />
                Docs
              </Link>
              <ChevronRight size={13} />
              <span className="docs-breadcrumb-current">{docTitle}</span>
            </nav>

            {/* Body */}
            <article
              className="doc-body"
              dangerouslySetInnerHTML={{ __html: html }}
            />

            {/* Prev / Next */}
            <nav className="docs-pager">
              {prev ? (
                <Link
                  to={`/docs/${prev.slug}`}
                  className="docs-pager-btn docs-pager-btn--prev"
                >
                  <ArrowLeft size={16} />
                  <span>
                    <span className="docs-pager-label">Previous</span>
                    <span className="docs-pager-title">{prev.title}</span>
                  </span>
                </Link>
              ) : (
                <div />
              )}
              {next ? (
                <Link
                  to={`/docs/${next.slug}`}
                  className="docs-pager-btn docs-pager-btn--next"
                >
                  <span>
                    <span className="docs-pager-label">Next</span>
                    <span className="docs-pager-title">{next.title}</span>
                  </span>
                  <ArrowRight size={16} />
                </Link>
              ) : (
                <div />
              )}
            </nav>
          </>
        ) : (
          <div className="docs-loading">
            <div className="docs-loading-spinner" />
            Loading…
          </div>
        )}
      </main>
    </div>
  );
}
