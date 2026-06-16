/**
 * scripts/generate-og.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates Open Graph PNG images at build time using satori + resvg-js.
 *
 * Usage:
 *   node scripts/generate-og.mjs [--page <name>]
 *
 * Without --page: generates og-home.png (the default landing page image).
 * With --page:    generates og-<name>.png (e.g. node scripts/generate-og.mjs --page tutorials)
 *
 * Output is written to public/ and picked up by Vite's public directory.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PUBLIC_DIR = join(ROOT, 'public');

// ── Font loading ──────────────────────────────────────────────────────────────

/**
 * Load the Inter font family from local TTF files.
 * Returns an array of { name, data: Buffer } entries satori expects.
 */
async function loadInterFont(weight = 400) {
  const weightMap = {
    100: 'Inter-Black.ttf', // 100 = Black (thin)
    200: 'Inter-Black.ttf',
    300: 'Inter-Bold.ttf', // ~Light/Regular range, use closest
    400: 'Inter-Regular.ttf',
    500: 'Inter-Medium.ttf',
    600: 'Inter-SemiBold.ttf',
    700: 'Inter-Bold.ttf',
    800: 'Inter-ExtraBold.ttf',
    900: 'Inter-Black.ttf',
  };
  const file = weightMap[weight] ?? 'Inter-Regular.ttf';
  const fontPath = join(__dirname, '..', 'fonts', file);
  return { name: 'Inter', data: readFileSync(fontPath) };
}

// ── OG image data ─────────────────────────────────────────────────────────────

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

// Brand colours
const BRAND = {
  bg: '#08080d',
  bgCard: '#111119',
  border: '#1a1a28',
  text: '#eeeef5',
  textSec: '#8888a0',
  accent: '#6366f1',
  accentH: '#818cf8',
};

const PAGE_TEMPLATES = {
  home: {
    title: 'OpenAidy',
    subtitle:
      'Open source AI agent platform.\nSelf-hosted, extensible, built for developers.',
    eyebrow: 'Open Source',
    accentLine: '#6366f1',
  },

  tutorials: {
    title: 'Tutorials',
    subtitle:
      'Step-by-step guides to get the most out of OpenAidy.\nWhatsApp integration, scheduling, plugins, and more.',
    eyebrow: 'Learn',
    accentLine: '#818cf8',
  },
};

// ── Satori element tree ───────────────────────────────────────────────────────

function buildOgElement(template) {
  const accentLineStyle = `linear-gradient(90deg, ${template.accentLine} 0%, #a855f7 50%, #ec4899 100%)`;

  return {
    type: 'div',
    props: {
      style: {
        width: '100%',
        height: '630px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        padding: '60px 72px',
        background: BRAND.bg,
        fontFamily: 'Inter',
        position: 'relative',
        overflow: 'hidden',
      },
      children: [
        // Background gradient orb (top-right)
        {
          type: 'div',
          props: {
            style: {
              position: 'absolute',
              top: '-120px',
              right: '-80px',
              width: '600px',
              height: '600px',
              borderRadius: '50%',
              background: `radial-gradient(circle, rgba(99,102,241,0.35) 0%, transparent 70%)`,
              pointerEvents: 'none',
            },
          },
        },
        // Second orb (bottom-left)
        {
          type: 'div',
          props: {
            style: {
              position: 'absolute',
              bottom: '-100px',
              left: '100px',
              width: '480px',
              height: '480px',
              borderRadius: '50%',
              background: `radial-gradient(circle, rgba(168,85,247,0.28) 0%, transparent 70%)`,
              pointerEvents: 'none',
            },
          },
        },
        // Grid dots overlay
        {
          type: 'div',
          props: {
            style: {
              position: 'absolute',
              inset: 0,
              backgroundImage: `radial-gradient(circle, rgba(99,102,241,0.08) 1px, transparent 1px)`,
              backgroundSize: '40px 40px',
              pointerEvents: 'none',
            },
          },
        },
        // Eyebrow
        {
          type: 'div',
          props: {
            style: {
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              marginBottom: '20px',
            },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    width: '7px',
                    height: '7px',
                    borderRadius: '50%',
                    background: template.accentLine,
                  },
                },
              },
              {
                type: 'span',
                props: {
                  style: {
                    fontSize: '13px',
                    fontWeight: 600,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: template.accentLine,
                    fontFamily: 'Inter',
                  },
                  children: template.eyebrow,
                },
              },
            ],
          },
        },
        // Title
        {
          type: 'div',
          props: {
            style: {
              position: 'relative',
              fontSize: template.title.length > 20 ? '68px' : '80px',
              fontWeight: 800,
              letterSpacing: '-0.04em',
              lineHeight: 1.0,
              color: BRAND.text,
              marginBottom: '24px',
              fontFamily: 'Inter',
            },
            children: template.title,
          },
        },
        // Gradient accent line
        {
          type: 'div',
          props: {
            style: {
              position: 'relative',
              width: '120px',
              height: '4px',
              borderRadius: '2px',
              background: accentLineStyle,
              marginBottom: '24px',
            },
          },
        },
        // Subtitle
        {
          type: 'div',
          props: {
            style: {
              position: 'relative',
              fontSize: '22px',
              fontWeight: 400,
              lineHeight: 1.6,
              color: BRAND.textSec,
              maxWidth: '680px',
              fontFamily: 'Inter',
            },
            children: template.subtitle,
          },
        },
        // Footer bar
        {
          type: 'div',
          props: {
            style: {
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: '3px',
              background: accentLineStyle,
            },
          },
        },
      ],
    },
  };
}

// ── Main generation ───────────────────────────────────────────────────────────

async function generateOg(pageName = 'home') {
  const template = PAGE_TEMPLATES[pageName];
  if (!template) {
    console.error(
      `Unknown page: "${pageName}". Available: ${Object.keys(PAGE_TEMPLATES).join(', ')}`,
    );
    process.exit(1);
  }

  const outputPath = join(PUBLIC_DIR, `og-${pageName}.png`);

  // Ensure public dir exists
  mkdirSync(PUBLIC_DIR, { recursive: true });

  const fonts = await Promise.all([
    loadInterFont(400),
    loadInterFont(600),
    loadInterFont(800),
  ]);

  const svg = await satori(buildOgElement(template), {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts,
  });

  // resvg: render SVG string → Resvg instance → PNG Buffer
  const resvg = new Resvg(svg);
  const pngBuffer = resvg.render().asPng();
  writeFileSync(outputPath, pngBuffer);

  console.log(`✓ Generated: public/og-${pageName}.png`);
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const pageIndex = process.argv.indexOf('--page');
const pageName = pageIndex !== -1 ? process.argv[pageIndex + 1] : 'home';

generateOg(pageName);
