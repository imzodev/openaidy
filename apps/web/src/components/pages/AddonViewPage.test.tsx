import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@solidjs/testing-library';
import { AddonViewPage } from './AddonViewPage';
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

  async function renderAndGetIframe() {
    const { findByTitle } = render(() => <AddonViewPage addon={ADDON} />);
    const iframe = (await findByTitle(ADDON.name)) as HTMLIFrameElement;
    // jsdom gives every rendered iframe a real contentWindow we can spy on.
    return iframe;
  }

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
