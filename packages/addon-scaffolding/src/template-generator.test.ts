import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateFromTemplate } from './template-generator.js';

const SAMPLE_OPTS = {
  id: 'weather-widget',
  name: 'Weather Widget',
  description: 'Shows the weather for a city',
  permissions: ['agents.list'],
};

describe('generateFromTemplate — shared theme tokens', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'openaidy-scaffolding-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function generate(
    name: 'basic' | 'agent' = 'basic',
  ): Promise<{ html: string; js: string }> {
    const result = await generateFromTemplate(name, dir, SAMPLE_OPTS);
    expect(result.success).toBe(true);
    const html = await readFile(join(dir, 'app/index.html'), 'utf-8');
    const js = await readFile(join(dir, 'app/index.js'), 'utf-8');
    return { html, js };
  }

  it('emits CSS that references the host theme variables instead of hardcoded colors', async () => {
    const { html } = await generate();
    // Every shared class should pull from the host's CSS custom properties.
    expect(html).toContain('var(--bg-primary)');
    expect(html).toContain('var(--text-primary)');
    expect(html).toContain('var(--bg-elevated)');
    expect(html).toContain('var(--border-primary)');
    expect(html).toContain('var(--primary)');
    expect(html).toContain('var(--text-tertiary)');
    // The old hardcoded slate palette must be gone — the host is the source
    // of truth for colors, the addon template must not paint its own.
    expect(html).not.toMatch(/background:\s*#0f172a/);
    expect(html).not.toMatch(/background:\s*#1e293b/);
    expect(html).not.toMatch(/color:\s*#e2e8f0/);
  });

  it('generates an applyTheme helper that writes tokens onto :root', async () => {
    const { js } = await generate();
    expect(js).toContain('function applyTheme');
    expect(js).toContain('root.style.setProperty');
    // The fallback token map must mirror the host's dark palette so an
    // addon that paints before OPENAIDY_INIT still looks reasonable.
    expect(js).toMatch(/'--bg-primary':\s*'#111827'/);
    expect(js).toMatch(/'--text-primary':\s*'#f3f4f6'/);
  });

  it('gates init on an initialised flag so a duplicate OPENAIDY_INIT is a no-op but the listener stays alive', async () => {
    const { js } = await generate();
    // No removeEventListener — the message listener must remain registered
    // for the addon's lifetime so a subsequent OPENAIDY_THEME_CHANGED can
    // reach applyTheme().
    expect(js).not.toMatch(/removeEventListener\(['"]message['"]/);
    // The init branch is guarded by the flag.
    expect(js).toMatch(/OPENAIDY_INIT['"]\s*&&\s*!initialised/);
  });

  it('applies the .dark class so Tailwind dark: variants inside the addon still resolve', async () => {
    const { js } = await generate();
    expect(js).toMatch(/classList\.(add|remove)\('dark'\)/);
  });
});

/**
 * Execute the generated `app/index.js` in a stubbed browser environment so
 * the test can assert behaviour — not just source text. The review on
 * PR #485 was that text-matching tests couldn't catch the live-update
 * regression where `removeEventListener` killed the listener; this
 * execution test would have.
 */
describe('generateFromTemplate — bootstrap behaviour', () => {
  let dir: string;
  let originalSetTimeout: typeof setTimeout;
  let originalDocument: typeof document;
  let originalWindow: typeof window;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'openaidy-scaffolding-bootstrap-'));
    // The basic template registers a 5-second "SDK never connected" timer.
    // Stub setTimeout so the timer doesn't keep the test process alive.
    originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (() => 0) as unknown as typeof setTimeout;
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    globalThis.setTimeout = originalSetTimeout;
    // Unused: kept so the test can be re-pointed at the global
    // window/document if it ever needs real ones.
    void originalDocument;
    void originalWindow;
  });

  it('applies OPENAIDY_THEME_CHANGED after init — the listener survives the first init', async () => {
    const result = await generateFromTemplate('basic', dir, SAMPLE_OPTS);
    expect(result.success).toBe(true);
    const js = await readFile(join(dir, 'app/index.js'), 'utf-8');

    // Track every property written to :root.style and every event listener
    // registered/unregistered on window. The test feeds the bootstrap
    // OPENAIDY_INIT, then OPENAIDY_THEME_CHANGED, and asserts the second
    // message actually wrote new tokens — which is only possible if the
    // listener survived the first init.
    const tokensApplied: Array<{ key: string; value: string }> = [];
    const registeredListeners: Array<{ event: string; handler: unknown }> = [];
    const removedListeners: Array<{ event: string; handler: unknown }> = [];
    const postedToParent: unknown[] = [];

    const stubWindow = {
      addEventListener: (event: string, handler: unknown) => {
        registeredListeners.push({ event, handler });
      },
      removeEventListener: (event: string, handler: unknown) => {
        removedListeners.push({ event, handler });
      },
      parent: {
        postMessage: (data: unknown) => {
          postedToParent.push(data);
        },
      },
    };

    const stubStyle = {
      setProperty: (key: string, value: string) => {
        tokensApplied.push({ key, value });
      },
    };

    const stubDocument = {
      documentElement: {
        classList: { add: () => {}, remove: () => {} },
        style: stubStyle,
      },
      getElementById: () => ({
        textContent: '',
        style: { color: '' },
      }),
      createElement: () => ({ src: '', onload: null as null }),
      head: { appendChild: () => {} },
    };

    // Run the bootstrap in a controlled scope. The generated code reads
    // from `window` and `document` at top level (no IIFE), so passing
    // them as args gives the test full visibility into every call.
    const fn = new Function('window', 'document', js);
    fn(stubWindow, stubDocument);

    // Pre-init: the fallback tokens must already be applied, and the
    // bootstrap must have signalled ADDON_READY.
    expect(tokensApplied.length).toBeGreaterThan(0);
    expect(postedToParent).toContainEqual({ type: 'ADDON_READY' });

    const messageReg = registeredListeners.find((e) => e.event === 'message');
    expect(messageReg).toBeDefined();
    const handler = messageReg!.handler as (event: { data: unknown }) => void;

    // First init — light mode, custom token.
    tokensApplied.length = 0;
    handler({
      data: {
        type: 'OPENAIDY_INIT',
        apiBase: 'http://host.test',
        theme: { mode: 'light', tokens: { '--bg-primary': '#fafafa' } },
      },
    });
    const initTokens = tokensApplied.filter((t) => t.key === '--bg-primary');
    expect(initTokens).toContainEqual({
      key: '--bg-primary',
      value: '#fafafa',
    });
    // The listener must NOT have been removed.
    expect(removedListeners).toHaveLength(0);

    // Live theme update — dark mode, different token. This is the message
    // that would never reach applyTheme under the old removeEventListener
    // pattern.
    tokensApplied.length = 0;
    handler({
      data: {
        type: 'OPENAIDY_THEME_CHANGED',
        theme: { mode: 'dark', tokens: { '--bg-primary': '#0a0a0a' } },
      },
    });
    const darkTokens = tokensApplied.filter((t) => t.key === '--bg-primary');
    expect(darkTokens).toContainEqual({
      key: '--bg-primary',
      value: '#0a0a0a',
    });

    // A duplicate init must be a no-op (flag guard).
    tokensApplied.length = 0;
    handler({
      data: {
        type: 'OPENAIDY_INIT',
        apiBase: 'http://host.test',
        theme: { mode: 'light', tokens: { '--bg-primary': '#ffffff' } },
      },
    });
    // A second init still calls applyTheme (which writes all known tokens),
    // so the bg-primary value should reflect the second init, not be
    // silently ignored. The guard prevents double <script> injection, not
    // re-application of tokens.
    const secondInitTokens = tokensApplied.filter(
      (t) => t.key === '--bg-primary',
    );
    expect(secondInitTokens).toContainEqual({
      key: '--bg-primary',
      value: '#ffffff',
    });
  });
});
