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

  it('handles OPENAIDY_THEME_CHANGED by reapplying tokens', async () => {
    const { js } = await generate();
    // The shared bootstrap should branch on the message type and re-apply
    // the theme when the host pushes a live update.
    expect(js).toContain('OPENAIDY_THEME_CHANGED');
    expect(js).toMatch(/OPENAIDY_THEME_CHANGED[\s\S]*applyTheme\(msg\.theme\)/);
  });

  it('applies the .dark class so Tailwind dark: variants inside the addon still resolve', async () => {
    const { js } = await generate();
    expect(js).toMatch(/classList\.(add|remove)\('dark'\)/);
  });

  it('removes the OPENAIDY_INIT listener after the first init so the rest of the lifetime only handles live theme updates', async () => {
    const { js } = await generate();
    // removeEventListener for the first-message branch — guarantees the
    // OPENAIDY_THEME_CHANGED branch is the one that survives a long-lived
    // addon.
    expect(js).toMatch(/removeEventListener\('message', onMessage\)/);
  });
});
