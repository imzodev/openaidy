import { useParams, Link, Navigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { motion } from 'framer-motion';
import { Calendar, Clock, ArrowLeft, User } from 'lucide-react';
import { blogPosts, getPostBySlug } from '../data/blog';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default function BlogPost() {
  const { slug } = useParams<{ slug: string }>();
  const post = slug ? getPostBySlug(slug) : undefined;

  if (!post) return <Navigate to="/blog" replace />;

  const related = blogPosts.filter((p) => p.slug !== slug).slice(0, 3);

  return (
    <div className="page-wrapper">
      <Helmet>
        <title>{post.title} — OpenAidy</title>
        <meta name="description" content={post.description} />
        <meta property="og:title" content={post.title} />
        <meta property="og:description" content={post.description} />
        <meta property="og:image" content="https://openaidy.com/og-blog.png" />
        <meta name="twitter:title" content={post.title} />
        <meta name="twitter:description" content={post.description} />
        <meta name="twitter:image" content="https://openaidy.com/og-blog.png" />
      </Helmet>
      {/* ── Back nav ───────────────────────────────────────────────── */}
      <div className="post-nav">
        <Link to="/blog" className="post-back">
          <ArrowLeft size={16} />
          All articles
        </Link>
      </div>

      {/* ── Article header ─────────────────────────────────────────── */}
      <article className="post-article">
        <motion.header
          className="post-header"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <span className="post-category">{post.category}</span>
          <h1 className="post-title">{post.title}</h1>
          <p className="post-description">{post.description}</p>

          <div className="post-byline">
            <span className="post-byline-item">
              <User size={14} />
              {post.author}
            </span>
            <span className="post-byline-sep" />
            <span className="post-byline-item">{post.authorRole}</span>
            <span className="post-byline-sep" />
            <span className="post-byline-item">
              <Calendar size={14} />
              {formatDate(post.date)}
            </span>
            <span className="post-byline-sep" />
            <span className="post-byline-item">
              <Clock size={14} />
              {post.readTime} read
            </span>
          </div>
        </motion.header>

        {/* ── Cover gradient strip ──────────────────────────────────── */}
        <motion.div
          className="post-cover"
          style={{ background: post.coverGradient }}
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, delay: 0.1 }}
        />

        {/* ── Body ─────────────────────────────────────────────────── */}
        <motion.div
          className="post-body"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          dangerouslySetInnerHTML={{ __html: post.content }}
        />

        {/* ── Footer ───────────────────────────────────────────────── */}
        <footer className="post-footer">
          <Link to="/blog" className="post-back-bottom">
            <ArrowLeft size={16} />
            Back to all articles
          </Link>
        </footer>
      </article>

      {/* ── Related posts ─────────────────────────────────────────── */}
      {related.length > 0 && (
        <section className="related-section">
          <h2 className="related-heading">More articles</h2>
          <div className="related-grid">
            {related.map((p) => (
              <Link
                key={p.slug}
                to={`/blog/${p.slug}`}
                className="related-card"
              >
                <div
                  className="related-card-cover"
                  style={{ background: p.coverGradient }}
                />
                <div className="related-card-body">
                  <span className="related-card-category">{p.category}</span>
                  <h3 className="related-card-title">{p.title}</h3>
                  <span className="related-card-date">
                    {formatDate(p.date)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
