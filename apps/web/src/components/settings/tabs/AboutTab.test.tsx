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

vi.mock('../../../lib/api', () => ({
  fetchAppInfo: vi.fn(),
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

describe('AboutTab', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    cleanup();
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
});
