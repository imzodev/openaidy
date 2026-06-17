import { Helmet } from 'react-helmet-async';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Calendar, Clock, ArrowRight } from 'lucide-react';
import { blogPosts } from '../data/blog';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

const categoryColor: Record<string, string> = {
  Announcement: '#6366f1',
  Tutorial: '#10b981',
  'Deep Dive': '#f59e0b',
  Roadmap: '#8b5cf6',
};

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

const fadeUp = {
  hidden: { opacity: 0, y: 22 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, delay: i * 0.08, ease: EASE },
  }),
};

export default function Blog() {
  return (
    <div className="page-wrapper">
      <Helmet>
        <title>Blog — OpenAidy</title>
        <meta
          name="description"
          content="Product news, tutorials, engineering deep dives, and roadmap updates from the OpenAidy team."
        />
        <meta property="og:title" content="Blog — OpenAidy" />
        <meta
          property="og:description"
          content="Product news, tutorials, engineering deep dives, and roadmap updates from the OpenAidy team."
        />
        <meta property="og:image" content="https://openaidy.com/og-blog.png" />
        <meta name="twitter:title" content="Blog — OpenAidy" />
        <meta
          name="twitter:description"
          content="Product news, tutorials, engineering deep dives, and roadmap updates."
        />
        <meta name="twitter:image" content="https://openaidy.com/og-blog.png" />
      </Helmet>

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="blog-hero">
        <div className="blog-hero-inner">
          <motion.span
            className="blog-eyebrow"
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4 }}
          >
            Blog
          </motion.span>
          <motion.h1
            className="blog-hero-title"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.05 }}
          >
            News, tutorials &amp; updates
          </motion.h1>
          <motion.p
            className="blog-hero-sub"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            Stay up to date with OpenAidy — product announcements, engineering
            deep dives, step-by-step guides, and the roadmap ahead.
          </motion.p>
        </div>
      </section>

      {/* ── Post grid ────────────────────────────────────────────────── */}
      <section className="blog-grid-section">
        <div className="blog-grid">
          {blogPosts.map((post, i) => {
            const accent = categoryColor[post.category] ?? '#6366f1';
            return (
              <motion.article
                key={post.slug}
                className="blog-card"
                custom={i}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-60px' }}
                variants={fadeUp}
              >
                {/* Cover strip */}
                <Link
                  to={`/blog/${post.slug}`}
                  className="blog-card-cover-link"
                  aria-label={post.title}
                >
                  <div
                    className="blog-card-cover"
                    style={{ background: post.coverGradient }}
                  >
                    <span
                      className="blog-card-category"
                      style={{ color: accent, borderColor: accent }}
                    >
                      {post.category}
                    </span>
                  </div>
                </Link>

                {/* Body */}
                <div className="blog-card-body">
                  <Link
                    to={`/blog/${post.slug}`}
                    className="blog-card-title-link"
                  >
                    <h2 className="blog-card-title">{post.title}</h2>
                  </Link>
                  <p className="blog-card-desc">{post.description}</p>

                  {/* Footer */}
                  <div className="blog-card-meta">
                    <span className="blog-card-meta-item">
                      <Calendar size={13} />
                      {formatDate(post.date)}
                    </span>
                    <span className="blog-card-meta-item">
                      <Clock size={13} />
                      {post.readTime} read
                    </span>
                  </div>

                  <Link to={`/blog/${post.slug}`} className="blog-card-cta">
                    Read article
                    <ArrowRight size={15} />
                  </Link>
                </div>
              </motion.article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
