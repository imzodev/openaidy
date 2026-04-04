import { describe, it, expect, vi } from 'vitest';
import { render } from '@solidjs/testing-library';
import { PresenceIndicator } from './PresenceIndicator';

vi.mock('../lib/ws-provider', () => ({
  useWebSocketContext: () => ({
    presence: () => [
      {
        clientId: 'client-1',
        status: 'online',
        metadata: { clientType: 'web' },
      },
      { clientId: 'client-2', status: 'away', metadata: { clientType: 'cli' } },
      {
        clientId: 'client-3',
        status: 'busy',
        metadata: { clientType: 'mobile' },
      },
    ],
    updatePresence: async () => {},
  }),
}));

describe('PresenceIndicator', () => {
  it('should render presence entries', () => {
    const { getByRole } = render(() => <PresenceIndicator />);
    expect(getByRole('group', { name: 'Presence' })).toBeDefined();
  });

  it('should show online count', () => {
    const { getByText } = render(() => <PresenceIndicator />);
    expect(getByText('1 online')).toBeDefined();
  });

  it('should show labels when enabled', () => {
    const { getAllByTitle } = render(() => <PresenceIndicator showLabels />);
    expect(getAllByTitle(/Web/)).toBeDefined();
  });
});
