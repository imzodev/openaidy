import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@solidjs/testing-library';
import { onMount } from 'solid-js';
import type { Theme } from '@openaidy/shared-types';
import { AddonViewPage } from './AddonViewPage';
import { ThemeProvider, useTheme } from '../../lib/theme';
import type { AddonRecord } from '../../lib/api';

vi.mock('../../lib/api', () => ({
  getAddonAssetToken: vi.fn(),
  refreshAddonToken: vi.fn(),
}));
vi.mock('../../lib/auth-token', () => ({
  resolveToken: vi.fn(),
}));

import { getAddonAssetToken, refreshAddonToken } from '../../lib/api';
import { resolveToken } from '../../lib/auth-token';

const ADDON: AddonRecord = {
  id: '1',
  addonId: 'weather-widget',
  name: 'Weather Widget',
  version: '1.0.0',
  status: 'enabled',
  installedAt: new Date(0).toISOString(),
  installedBy: 'admin',
  manifest: {},
  permissions: [],
};

const ADDON_TOKEN_KEY = `openaidy_addon_token:${ADDON.addonId}`;

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
  } as unknown as Response;
}

/** Simulate a postMessage as if it came from `iframe`'s own contentWindow. */
function postFromIframe(iframe: HTMLIFrameElement, data: unknown) {
  window.dispatchEvent(
    new MessageEvent('message', { data, source: iframe.contentWindow }),
  );
}

/**
 * Render the AddonViewPage inside a ThemeProvider (the host's theme context
 * is required since the component subscribes to it) and return the rendered
 * iframe. The optional `capture` callback receives the live `setTheme` from
 * the theme context so a test can drive a theme change and assert that
 * `OPENAIDY_THEME_CHANGED` fires.
 */
async function renderAndGetIframe(
  capture?: (api: { setTheme: (t: Theme) => void }) => void,
) {
  const { findByTitle } = render(() => (
    <ThemeProvider>
      {capture ? <ThemeBridge onReady={capture} /> : null}
      <AddonViewPage addon={ADDON} />
    </ThemeProvider>
  ));
  const iframe = (await findByTitle(ADDON.name)) as HTMLIFrameElement;
  return iframe;
}

describe('AddonViewPage — token isolation from the sandboxed iframe', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(ADDON_TOKEN_KEY, 'ADDON_SCOPED_TOKEN');
    vi.mocked(getAddonAssetToken).mockResolvedValue({
      token: 'ASSET_TOKEN',
      expiresIn: 600_000,
    });
    // The user is logged in with a real master token — the point of these
    // tests is that this token must never reach the iframe or be used to
    // authorize an addon-proxy request.
    vi.mocked(resolveToken).mockReturnValue('MASTER_ADMIN_TOKEN');
    vi.mocked(refreshAddonToken).mockResolvedValue({
      accessToken: 'ADDON_SCOPED_TOKEN',
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({})));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('never includes the master token in the OPENAIDY_INIT message', async () => {
    const iframe = await renderAndGetIframe();
    const postMessage = vi.spyOn(iframe.contentWindow!, 'postMessage');

    iframe.dispatchEvent(new Event('load'));

    expect(postMessage).toHaveBeenCalled();
    const [payload] = postMessage.mock.calls[0]!;
    expect(payload).toMatchObject({ type: 'OPENAIDY_INIT' });
    expect(payload).not.toHaveProperty('token');
  });

  it('authorizes an allowed addon-proxy request with the addon-scoped token, never the master token', async () => {
    const iframe = await renderAndGetIframe();
    const postMessage = vi.spyOn(iframe.contentWindow!, 'postMessage');
    iframe.dispatchEvent(new Event('load'));
    const initPayload = postMessage.mock.calls[0]![0] as { nonce: string };

    postFromIframe(iframe, {
      type: 'OPENAIDY_REQUEST',
      requestId: 'req-1',
      method: 'GET',
      path: '/api/addon-proxy/notes',
      nonce: initPayload.nonce,
    });

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const headers = init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer ADDON_SCOPED_TOKEN');
    expect(headers.Authorization).not.toContain('MASTER_ADMIN_TOKEN');
  });

  it('fails closed (401, no fetch) when the addon-scoped token is missing — no fallback to the master token', async () => {
    // Prevent onMount's auto-heal (refreshAddonToken) from silently
    // repopulating the token — this test wants it to stay genuinely absent.
    vi.mocked(refreshAddonToken).mockRejectedValue(new Error('unavailable'));
    localStorage.removeItem(ADDON_TOKEN_KEY);
    const iframe = await renderAndGetIframe();
    localStorage.removeItem(ADDON_TOKEN_KEY);
    const postMessage = vi.spyOn(iframe.contentWindow!, 'postMessage');
    iframe.dispatchEvent(new Event('load'));
    const initPayload = postMessage.mock.calls[0]![0] as { nonce: string };
    postMessage.mockClear();

    postFromIframe(iframe, {
      type: 'OPENAIDY_REQUEST',
      requestId: 'req-2',
      method: 'GET',
      path: '/api/addon-proxy/notes',
      nonce: initPayload.nonce,
    });

    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'OPENAIDY_RESPONSE', status: 401 }),
        '*',
      ),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a request outside the addon-proxy allowlist without ever touching fetch or the master token', async () => {
    const iframe = await renderAndGetIframe();
    const postMessage = vi.spyOn(iframe.contentWindow!, 'postMessage');
    iframe.dispatchEvent(new Event('load'));
    const initPayload = postMessage.mock.calls[0]![0] as { nonce: string };
    postMessage.mockClear();

    postFromIframe(iframe, {
      type: 'OPENAIDY_REQUEST',
      requestId: 'req-3',
      method: 'GET',
      path: '/api/agents',
      nonce: initPayload.nonce,
    });

    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'OPENAIDY_RESPONSE', status: 403 }),
        '*',
      ),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("ignores a message whose source is not this addon's own iframe, even with type ADDON_READY", async () => {
    const iframe = await renderAndGetIframe();
    const postMessage = vi.spyOn(iframe.contentWindow!, 'postMessage');
    iframe.dispatchEvent(new Event('load'));
    postMessage.mockClear();

    // No `source` set — simulates a message from an unrelated frame/window,
    // which must not trigger sendInit() again.
    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'ADDON_READY' } }),
    );

    // Give any (incorrect) async handling a tick to run, then assert nothing happened.
    await new Promise((r) => setTimeout(r, 0));
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('honors ADDON_READY from the real iframe with no nonce required', async () => {
    const iframe = await renderAndGetIframe();
    const postMessage = vi.spyOn(iframe.contentWindow!, 'postMessage');

    postFromIframe(iframe, { type: 'ADDON_READY' });

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'OPENAIDY_INIT' }),
      '*',
    );
  });
});

/**
 * Tiny bridge component used by the theme-propagation tests. Mounts inside
 * the ThemeProvider so it can grab the live `setTheme` and hand it to the
 * test via a callback. Renders nothing.
 */
function ThemeBridge(props: {
  onReady: (api: { setTheme: (t: Theme) => void }) => void;
}) {
  const { setTheme } = useTheme();
  onMount(() => props.onReady({ setTheme }));
  return null;
}

describe('AddonViewPage — host theme propagation', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(ADDON_TOKEN_KEY, 'ADDON_SCOPED_TOKEN');
    // Pin the host to 'dark' so the initial resolvedTheme is known and the
    // live-update test below can force a change by flipping to 'light'.
    // (localStorage isn't read on every test, only on the ThemeProvider's
    // initial signal value.)
    localStorage.setItem('theme', 'dark');
    document.documentElement.classList.add('dark');
    // jsdom doesn't load the host's stylesheet, so getComputedStyle returns
    // empty for the CSS variables. Stamp the canonical tokens onto :root's
    // inline style so the addon's theme tokens resolve to something
    // testable, mirroring the real values apps/web/src/index.css ships.
    const root = document.documentElement;
    root.style.setProperty('--primary', '#3b82f6');
    root.style.setProperty('--bg-primary', '#111827');
    root.style.setProperty('--bg-elevated', '#1f2937');
    root.style.setProperty('--text-primary', '#f3f4f6');
    root.style.setProperty('--text-tertiary', '#9ca3af');
    root.style.setProperty('--border-primary', '#374151');
    vi.mocked(getAddonAssetToken).mockResolvedValue({
      token: 'ASSET_TOKEN',
      expiresIn: 600_000,
    });
    vi.mocked(resolveToken).mockReturnValue('MASTER_ADMIN_TOKEN');
    vi.mocked(refreshAddonToken).mockResolvedValue({
      accessToken: 'ADDON_SCOPED_TOKEN',
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({})));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    document.documentElement.removeAttribute('class');
    document.documentElement.removeAttribute('style');
  });

  it('includes the current theme (mode + tokens) in the OPENAIDY_INIT message', async () => {
    const iframe = await renderAndGetIframe();
    const postMessage = vi.spyOn(iframe.contentWindow!, 'postMessage');

    iframe.dispatchEvent(new Event('load'));

    expect(postMessage).toHaveBeenCalled();
    const [payload] = postMessage.mock.calls[0]!;
    const init = payload as {
      type: 'OPENAIDY_INIT';
      theme: { mode: 'light' | 'dark'; tokens: Record<string, string> };
    };
    expect(init.type).toBe('OPENAIDY_INIT');
    // localStorage 'theme' = 'dark' + dark class on <html> → host is in dark mode.
    expect(init.theme.mode).toBe('dark');
    // The token map is the host's source of truth — at least the canonical
    // background/text tokens must be present so the addon can paint.
    expect(init.theme.tokens['--bg-primary']).toBe('#111827');
    expect(init.theme.tokens['--text-primary']).toBe('#f3f4f6');
  });

  it('posts OPENAIDY_THEME_CHANGED to the iframe when the host theme changes', async () => {
    let setTheme: ((t: Theme) => void) | undefined;
    const iframe = await renderAndGetIframe((api) => {
      setTheme = api.setTheme;
    });
    const postMessage = vi.spyOn(iframe.contentWindow!, 'postMessage');
    iframe.dispatchEvent(new Event('load'));
    postMessage.mockClear();

    // Flip from 'dark' (initial) to 'light' so resolvedTheme actually
    // changes value — Solid signals skip subscribers when the value is
    // unchanged, so the initial 'system' default would not re-fire here.
    setTheme!('light');

    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'OPENAIDY_THEME_CHANGED' }),
        '*',
      ),
    );
    const themePayload = (
      postMessage.mock.calls[0]![0] as {
        theme: { mode: 'light' | 'dark'; tokens: Record<string, string> };
      }
    ).theme;
    expect(themePayload.mode).toBe('light');
  });

  it('reflects a system-preference change without a manual toggle', async () => {
    // The ThemeProvider listens to matchMedia('(prefers-color-scheme: dark)')
    // and updates resolvedTheme when it fires. We simulate that with a
    // matchMedia override on the document and verify the addon follows.
    const listeners: Array<(ev: { matches: boolean }) => void> = [];
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => {
      const mql = {
        matches: false,
        media: query,
        onchange: null,
        addEventListener: (_: string, cb: (e: { matches: boolean }) => void) =>
          listeners.push(cb),
        removeEventListener: () => {},
        addListener: (cb: (e: { matches: boolean }) => void) =>
          listeners.push(cb),
        removeListener: () => {},
        dispatchEvent: () => true,
      };
      return mql as unknown as MediaQueryList;
    });

    let setTheme: ((t: Theme) => void) | undefined;
    const iframe = await renderAndGetIframe((api) => {
      setTheme = api.setTheme;
    });
    const postMessage = vi.spyOn(iframe.contentWindow!, 'postMessage');
    iframe.dispatchEvent(new Event('load'));
    postMessage.mockClear();
    // Start the host in 'system' so the matchMedia listener is the one that
    // drives resolvedTheme.
    setTheme!('system');
    postMessage.mockClear();

    // The host's <html> flips to dark when matchMedia fires.
    document.documentElement.classList.add('dark');
    for (const cb of listeners) cb({ matches: true });

    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'OPENAIDY_THEME_CHANGED',
          theme: expect.objectContaining({ mode: 'dark' }),
        }),
        '*',
      ),
    );
  });
});
