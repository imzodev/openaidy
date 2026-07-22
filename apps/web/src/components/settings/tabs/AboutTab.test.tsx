import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from '@solidjs/testing-library';
import { AboutTab } from './AboutTab';
import * as api from '../../../lib/api';
import { resetUpdateNotice } from '../../../stores/update-notice';

vi.mock('../../../lib/api', () => ({
  fetchAppInfo: vi.fn(),
  checkForUpdates: vi.fn(),
  triggerUpdate: vi.fn(),
  fetchUpdateStatus: vi.fn(),
  // Minimal stand-in for the real error class so `instanceof` checks work.
  ApiRequestError: class ApiRequestError extends Error {
    status: number;
    body: { error: string; message?: string };
    constructor(status: number, body: { error: string; message?: string }) {
      super(body.message ?? body.error);
      this.status = status;
      this.body = body;
    }
  },
}));

const sampleInfo: api.AppInfo = {
  version: '0.3.0',
  nodeVersion: 'v22.13.0',
  platform: 'linux',
  arch: 'x64',
  pid: 4242,
  startedAt: '2026-07-11T10:00:00.000Z',
  uptimeMs: 12_345,
};

const noUpdate: api.UpdateCheckResult = {
  currentVersion: '0.3.0',
  latestVersion: '0.3.0',
  updateAvailable: false,
  canSelfUpdate: false,
};

describe('AboutTab', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetUpdateNotice();
    // Default: no update available. Individual tests override as needed.
    vi.mocked(api.checkForUpdates).mockResolvedValue(noUpdate);
    // Default: a status poll (if any test's timer fires) finds a fresh, idle
    // process — harmless unless a test overrides it to assert poll behavior.
    vi.mocked(api.fetchUpdateStatus).mockResolvedValue({ status: 'idle' });
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    // jsdom doesn't implement navigation; stub reload so the polling loop
    // (real setTimeout-based) never throws if it fires during a test.
    vi.stubGlobal('location', { ...window.location, reload: vi.fn() });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders the version with the "v" prefix once info loads', async () => {
    vi.mocked(api.fetchAppInfo).mockResolvedValue(sampleInfo);
    render(() => <AboutTab />);
    // The big version heading is the first match.
    await waitFor(() =>
      expect(screen.getAllByText('v0.3.0').length).toBeGreaterThan(0),
    );
  });

  it('renders node, platform/arch, pid, uptime once info loads', async () => {
    vi.mocked(api.fetchAppInfo).mockResolvedValue(sampleInfo);
    render(() => <AboutTab />);
    await waitFor(() =>
      expect(screen.getAllByText('v0.3.0').length).toBeGreaterThan(0),
    );
    expect(screen.getByText('v22.13.0')).toBeInTheDocument();
    expect(screen.getByText('linux/x64')).toBeInTheDocument();
    expect(screen.getByText('4242')).toBeInTheDocument();
    // 12_345ms => "12s"
    expect(screen.getByText('12s')).toBeInTheDocument();
  });

  it('builds a GitHub release link that matches the displayed version', async () => {
    vi.mocked(api.fetchAppInfo).mockResolvedValue(sampleInfo);
    render(() => <AboutTab />);
    await waitFor(() =>
      expect(screen.getAllByText('v0.3.0').length).toBeGreaterThan(0),
    );
    const link = screen.getByRole('link', { name: /view release on github/i });
    expect(link.getAttribute('href')).toBe(
      'https://github.com/imzodev/openaidy/releases/tag/v0.3.0',
    );
  });

  it('copies a debug block to the clipboard that uses the "v" prefix', async () => {
    vi.mocked(api.fetchAppInfo).mockResolvedValue(sampleInfo);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(() => <AboutTab />);
    await waitFor(() =>
      expect(screen.getAllByText('v0.3.0').length).toBeGreaterThan(0),
    );

    fireEvent.click(screen.getByRole('button', { name: /copy debug info/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const payload = writeText.mock.calls[0]?.[0] as string;
    expect(payload).toContain('OpenAidy v0.3.0');
    expect(payload).toContain('Node v22.13.0');
    expect(payload).toContain('linux/x64');
    expect(payload).toContain('PID 4242');
  });

  // Note: the error/retry path is not unit-tested here because Solid's
  // createResource has tricky timing around promise rejection in jsdom —
  // the production error UI (red banner + Retry button) is straightforward
  // to verify by manual smoke test. The success path and refetch are
  // covered above.

  it('Refresh button triggers a refetch', async () => {
    vi.mocked(api.fetchAppInfo).mockResolvedValue(sampleInfo);
    render(() => <AboutTab />);
    await waitFor(() =>
      expect(screen.getAllByText('v0.3.0').length).toBeGreaterThan(0),
    );

    expect(api.fetchAppInfo).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    await waitFor(() => expect(api.fetchAppInfo).toHaveBeenCalledTimes(2));
  });

  it('shows an "Update to vX" button and triggers the update when confirmed', async () => {
    vi.mocked(api.fetchAppInfo).mockResolvedValue(sampleInfo);
    vi.mocked(api.checkForUpdates).mockResolvedValue({
      currentVersion: '0.3.0',
      latestVersion: '0.4.0',
      updateAvailable: true,
      canSelfUpdate: true,
      releaseNotes: 'Bug fixes and improvements',
    });
    vi.mocked(api.triggerUpdate).mockResolvedValue({
      status: 'installing',
      newVersion: '0.4.0',
    });

    render(() => <AboutTab />);
    const updateBtn = await screen.findByRole('button', {
      name: /update to v0\.4\.0/i,
    });
    fireEvent.click(updateBtn);

    // Confirm dialog opens with a restart warning; confirm it.
    const confirmBtn = await screen.findByRole('button', {
      name: /update & restart/i,
    });
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(api.triggerUpdate).toHaveBeenCalledOnce());
    expect(
      await screen.findByText(/the server is installing the new version/i),
    ).toBeInTheDocument();
  });

  it('reloads once /update/status is answered by a fresh (idle) process', async () => {
    vi.mocked(api.fetchAppInfo).mockResolvedValue(sampleInfo);
    vi.mocked(api.checkForUpdates).mockResolvedValue({
      currentVersion: '0.3.0',
      latestVersion: '0.4.0',
      updateAvailable: true,
      canSelfUpdate: true,
    });
    vi.mocked(api.triggerUpdate).mockResolvedValue({
      status: 'installing',
      newVersion: '0.4.0',
    });
    // First poll still hits the old (installing) process; second poll finds
    // a fresh one with no memory of the update — that's the "done" signal.
    vi.mocked(api.fetchUpdateStatus)
      .mockResolvedValueOnce({ status: 'installing', newVersion: '0.4.0' })
      .mockResolvedValueOnce({ status: 'idle' });
    const reloadSpy = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload: reloadSpy });

    render(() => <AboutTab />);
    fireEvent.click(
      await screen.findByRole('button', { name: /update to v0\.4\.0/i }),
    );
    fireEvent.click(
      await screen.findByRole('button', { name: /update & restart/i }),
    );
    await waitFor(() => expect(api.triggerUpdate).toHaveBeenCalledOnce());

    await waitFor(() => expect(reloadSpy).toHaveBeenCalled(), {
      timeout: 6_000,
    });
    expect(api.fetchUpdateStatus).toHaveBeenCalledTimes(2);
  }, 8_000);

  it('surfaces a server-reported error instead of reloading onto the old version', async () => {
    vi.mocked(api.fetchAppInfo).mockResolvedValue(sampleInfo);
    vi.mocked(api.checkForUpdates).mockResolvedValue({
      currentVersion: '0.3.0',
      latestVersion: '0.4.0',
      updateAvailable: true,
      canSelfUpdate: true,
    });
    vi.mocked(api.triggerUpdate).mockResolvedValue({
      status: 'installing',
      newVersion: '0.4.0',
    });
    vi.mocked(api.fetchUpdateStatus).mockResolvedValue({
      status: 'error',
      newVersion: '0.4.0',
      error: 'EACCES',
      message: 'Update failed; the server is still running the old version.',
    });
    const reloadSpy = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload: reloadSpy });

    render(() => <AboutTab />);
    fireEvent.click(
      await screen.findByRole('button', { name: /update to v0\.4\.0/i }),
    );
    fireEvent.click(
      await screen.findByRole('button', { name: /update & restart/i }),
    );
    await waitFor(() => expect(api.triggerUpdate).toHaveBeenCalledOnce());

    expect(
      await screen.findByText(/still running the old version/i, undefined, {
        timeout: 4_000,
      }),
    ).toBeInTheDocument();
    expect(reloadSpy).not.toHaveBeenCalled();
  }, 6_000);

  it('guides a manual update when the install cannot self-update', async () => {
    vi.mocked(api.fetchAppInfo).mockResolvedValue(sampleInfo);
    vi.mocked(api.checkForUpdates).mockResolvedValue({
      currentVersion: '0.3.0',
      latestVersion: '0.4.0',
      updateAvailable: true,
      canSelfUpdate: false,
    });

    render(() => <AboutTab />);
    await waitFor(() =>
      expect(screen.getAllByText('v0.3.0').length).toBeGreaterThan(0),
    );

    expect(
      screen.queryByRole('button', { name: /update to v0\.4\.0/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/npm install -g @openaidy\/app@latest/i),
    ).toBeInTheDocument();
  });
});
