import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@solidjs/testing-library';
import { DesktopStatusBar } from './DesktopStatusBar';

const { checkForUpdateMock, installUpdateMock, useTauriMock } = vi.hoisted(
  () => ({
    checkForUpdateMock: vi.fn(),
    installUpdateMock: vi.fn(),
    useTauriMock: vi.fn(),
  }),
);

vi.mock('../lib/tauri-provider', () => ({
  useTauri: useTauriMock,
}));

vi.mock('../lib/tauri-bridge', () => ({
  restartService: vi.fn(),
  checkForUpdate: checkForUpdateMock,
  installUpdate: installUpdateMock,
}));

function mockDesktopContext(overrides: Partial<{ isConnected: boolean }> = {}) {
  useTauriMock.mockReturnValue({
    isDesktop: true,
    serviceStatus: () => ({
      state: overrides.isConnected === false ? 'Idle' : 'Running',
      port: 3001,
      restart_attempts: 0,
      pid: 1234,
      openaidy_home: '/home/user/.config/openaidy',
    }),
    isConnected: () => overrides.isConnected !== false,
  });
}

describe('DesktopStatusBar update notice', () => {
  it('renders nothing update-related when no update is available', async () => {
    mockDesktopContext();
    checkForUpdateMock.mockResolvedValue(null);

    render(() => <DesktopStatusBar />);

    await waitFor(() => expect(checkForUpdateMock).toHaveBeenCalled());
    expect(screen.queryByText(/update available/i)).not.toBeInTheDocument();
  });

  it('shows an install prompt when an update is available, and installs on click', async () => {
    mockDesktopContext();
    const fakeUpdate = { version: '9.9.9' };
    checkForUpdateMock.mockResolvedValue(fakeUpdate);
    installUpdateMock.mockResolvedValue(undefined);

    render(() => <DesktopStatusBar />);

    const button = await screen.findByText(/update available/i);
    button.click();

    await waitFor(() =>
      expect(installUpdateMock).toHaveBeenCalledWith(
        fakeUpdate,
        expect.any(Function),
      ),
    );
  });

  it('shows an error state if installing the update fails', async () => {
    mockDesktopContext();
    checkForUpdateMock.mockResolvedValue({ version: '9.9.9' });
    installUpdateMock.mockRejectedValue(new Error('network blip'));

    render(() => <DesktopStatusBar />);

    const button = await screen.findByText(/update available/i);
    button.click();

    await screen.findByText(/update failed/i);
  });
});
