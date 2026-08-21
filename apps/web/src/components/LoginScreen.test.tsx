import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@solidjs/testing-library';
import { LoginScreen } from './LoginScreen';

const { getBootstrapAdminTokenMock } = vi.hoisted(() => ({
  getBootstrapAdminTokenMock: vi.fn<() => Promise<string | null>>(),
}));

vi.mock('../lib/tauri-bridge', () => ({
  getBootstrapAdminToken: getBootstrapAdminTokenMock,
}));

describe('LoginScreen', () => {
  it('pre-fills the token field from the desktop app IPC bridge', async () => {
    getBootstrapAdminTokenMock.mockResolvedValue('desktop-token-123');

    render(() => <LoginScreen onAuthenticated={() => {}} />);

    const textarea = await screen.findByLabelText('API Token');
    await waitFor(() =>
      expect((textarea as HTMLTextAreaElement).value).toBe('desktop-token-123'),
    );
    expect(
      screen.getByText(/token pre-filled\. press connect to continue/i),
    ).toBeInTheDocument();
  });

  it('leaves the field blank outside the desktop app (no token available)', async () => {
    getBootstrapAdminTokenMock.mockResolvedValue(null);

    render(() => <LoginScreen onAuthenticated={() => {}} />);

    const textarea = await screen.findByLabelText('API Token');
    // Give the onMount microtask a tick to resolve before asserting the
    // negative — otherwise this would trivially pass before it even runs.
    await Promise.resolve();
    expect((textarea as HTMLTextAreaElement).value).toBe('');
    expect(
      screen.getByText(/enter your api token to continue/i),
    ).toBeInTheDocument();
  });
});
