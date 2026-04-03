import { describe, expect, it } from 'vitest';
import { WebSocketClient } from '../websocket-client.js';
import { ChannelAdapter } from './channel.js';

describe('ChannelAdapter', () => {
  it('should expose channel client type', () => {
    const adapter = new ChannelAdapter();
    expect(adapter.clientType).toBe('channel');
  });

  it('should create websocket client instance', () => {
    const adapter = new ChannelAdapter();
    const client = adapter.createClient({
      url: 'ws://localhost:3000/ws',
    });

    expect(client).toBeInstanceOf(WebSocketClient);
    client.destroy();
  });
});
