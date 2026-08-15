import { describe, it, expect, vi } from 'vitest';
import { toStatusResponse } from './status.js';
import type { IChannel } from './interface.js';

function mockChannel(overrides: Partial<IChannel> = {}): IChannel {
  return {
    id: 'ch-1',
    type: 'discord',
    agentId: 'agent-1',
    getStatus: () => 'disconnected',
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    onStatusChange: vi.fn(),
    removeListener: vi.fn(),
    ...overrides,
  };
}

describe('toStatusResponse', () => {
  it('omits error when the channel has no getLastError implementation', () => {
    const response = toStatusResponse(mockChannel());
    expect(response).not.toHaveProperty('error');
  });

  it('omits error when getLastError() returns undefined', () => {
    const response = toStatusResponse(
      mockChannel({ getLastError: () => undefined }),
    );
    expect(response).not.toHaveProperty('error');
  });

  it('includes error when getLastError() returns a message', () => {
    const response = toStatusResponse(
      mockChannel({
        getStatus: () => 'error',
        getLastError: () => 'Something went wrong',
      }),
    );
    expect(response.status).toBe('error');
    expect(response.error).toBe('Something went wrong');
  });
});
