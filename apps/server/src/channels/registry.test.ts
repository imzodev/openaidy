import { describe, it, expect, vi } from 'vitest';
import { ChannelRegistry } from './registry.js';
import type { IChannel } from './interface.js';

function mockChannel(id: string): IChannel {
  return {
    id,
    type: 'test',
    agentId: 'test-agent',
    getStatus: () => 'disconnected',
    getQr: () => null,
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    onQrUpdate: vi.fn(),
    onStatusChange: vi.fn(),
    removeListener: vi.fn(),
  };
}

describe('ChannelRegistry', () => {
  it('registers and retrieves a channel by id', () => {
    const registry = new ChannelRegistry();
    const ch = mockChannel('test-1');
    registry.register(ch);
    expect(registry.get('test-1')).toBe(ch);
  });

  it('throws when registering a duplicate id', () => {
    const registry = new ChannelRegistry();
    registry.register(mockChannel('dup'));
    expect(() => registry.register(mockChannel('dup'))).toThrow(
      'already registered',
    );
  });

  it('getAll returns all registered channels', () => {
    const registry = new ChannelRegistry();
    registry.register(mockChannel('a'));
    registry.register(mockChannel('b'));
    expect(registry.getAll()).toHaveLength(2);
  });

  it('remove disconnects and deletes the channel', async () => {
    const registry = new ChannelRegistry();
    const ch = mockChannel('x');
    registry.register(ch);
    await registry.remove('x');
    expect(ch.disconnect).toHaveBeenCalledOnce();
    expect(registry.get('x')).toBeUndefined();
  });

  it('remove is a no-op for unknown ids', async () => {
    const registry = new ChannelRegistry();
    await expect(registry.remove('nonexistent')).resolves.toBeUndefined();
  });
});
