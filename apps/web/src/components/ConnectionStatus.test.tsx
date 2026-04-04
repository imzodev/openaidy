import { describe, it, expect, vi } from 'vitest';
import { render } from '@solidjs/testing-library';
import { ConnectionStatus } from './ConnectionStatus';

vi.mock('../lib/ws-provider', () => ({
  useWebSocketContext: () => ({
    state: () => 'connected',
    error: () => undefined,
  }),
}));

describe('ConnectionStatus', () => {
  it('should render connected state', () => {
    const { getByRole } = render(() => <ConnectionStatus />);
    expect(getByRole('status')).toBeDefined();
  });

  it('should render with details', () => {
    const { getByText } = render(() => <ConnectionStatus showDetails />);
    expect(getByText('Connected')).toBeDefined();
  });
});
