# OpenAidy Landing Site

Landing site is a Vite+React SPA at `/tmp/openaidy/landing`. The agent's fork is `agentjetsonimzodev/openaidy`, branch `landing-site-improvements`, PR targets upstream `imzodev/openaidy`.

## Key Patterns

### Static Files → SPA Route Transition

When a section previously served as static files from `public/X/` and gains a real SPA page at `/X`:

- Navbar/footer links that were `<a href="/X">` must become `<Link to="/X">` from React Router
- Otherwise the browser loads `public/X/index.html` as a static file, bypassing the SPA router entirely
- The SPA page component then reads and renders content from the `public/` directory on the client side

### Docs Page (`/docs/*`)

- Markdown files live in `public/docs/` (served as static assets)
- `Docs.tsx` reads and renders them client-side via `fetch()` + `marked`
- Per-doc `<Helmet>` for title/description
- Relative `.md` links in docs converted to `/docs/*` SPA routes
- Mobile: hamburger + slide-in sidebar overlay

### Blog (`/blog`, `/blog/:slug`)

- Posts defined in `src/data/blog.ts` with frontmatter (title, date, excerpt, image, readTime)
- `Blog.tsx` lists all posts with cover image + excerpt
- `BlogPost.tsx` renders full post, parses frontmatter, renders body via `marked`
- OG images in `public/` (named `blog-<slug>-og.png`) linked via `<Helmet>`

### Updating an Existing PR

When the PR already exists:

```bash
git fetch origin
git rebase origin/main
git push --force-with-lease origin HEAD
```

Do NOT close and reopen a PR to update it.

### Adding New Pages

1. Create `src/pages/NewPage.tsx` — standard page layout with Navbar/Footer
2. Add route in `src/App.tsx`: `<Route path="/new-page" element={<NewPage />} />`
3. Add `<Link to="/new-page">` or `<NavLink>` in Navbar and Footer
4. Run `npm run build` to verify TypeScript compiles clean
5. Commit and push: `git add -A && git commit -m "feat: add new page" && git push`

### Landing Stack

- Vite + React 18 + TypeScript
- `react-router-dom` v6 for routing
- `framer-motion` for page transitions (`AnimatePresence`)
- `marked` for markdown rendering
- `react-helmet` for `<head>` management
- CSS variables scoped to `[data-theme]` for light/dark (via `next-themes`)
- Motion must respect `prefers-reduced-motion`
- No continuous RAF tracking, no Lenis smooth scroll — CSS keyframes for ambient, spring-on-event only
