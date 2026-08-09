import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence, motion, type Variants } from 'framer-motion';
import Navbar from './components/Navbar';
import Home from './pages/Home';
import Tutorials from './pages/Tutorials';
import Blog from './pages/Blog';
import BlogPost from './pages/BlogPost';
import Docs from './pages/Docs';
import Footer from './components/Footer';

const pageVariants: Variants = {
  initial: { opacity: 0, y: 18 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.38, ease: [0.16, 1, 0.3, 1] as const },
  },
  exit: {
    opacity: 0,
    y: -12,
    transition: { duration: 0.22, ease: [0.4, 0, 1, 1] as const },
  },
};

function AnimatedPage({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      {children}
    </motion.div>
  );
}

function AppRoutes() {
  const location = useLocation();
  // Group all /docs/* pages under one animation key so navigating between
  // docs pages doesn't replay the page-transition (fade/slide) — only
  // entering or leaving the docs section does.
  const transitionKey = location.pathname.startsWith('/docs')
    ? '/docs'
    : location.pathname;

  return (
    <AnimatePresence mode="wait" initial={false}>
      <Routes location={location} key={transitionKey}>
        <Route
          path="/"
          element={
            <AnimatedPage>
              <Home />
            </AnimatedPage>
          }
        />
        <Route
          path="/tutorials"
          element={
            <AnimatedPage>
              <Tutorials />
            </AnimatedPage>
          }
        />
        <Route
          path="/blog"
          element={
            <AnimatedPage>
              <Blog />
            </AnimatedPage>
          }
        />
        <Route
          path="/blog/:slug"
          element={
            <AnimatedPage>
              <BlogPost />
            </AnimatedPage>
          }
        />
        <Route
          path="/docs/*"
          element={
            <AnimatedPage>
              <Docs />
            </AnimatedPage>
          }
        />
      </Routes>
    </AnimatePresence>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Navbar />
      <main>
        <AppRoutes />
      </main>
      <Footer />
    </BrowserRouter>
  );
}
