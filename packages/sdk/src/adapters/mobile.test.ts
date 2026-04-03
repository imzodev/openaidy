import { describe, expect, it } from 'vitest';
import { WebSocketClient } from '../websocket-client.js';
import { MobileAdapter } from './mobile.js';

describe('MobileAdapter', () => {
  it('should expose mobile client type', () => {
    const adapter = new MobileAdapter();
    expect(adapter.clientType).toBe('mobile');
  });

  it('should create websocket client instance', () => {
    const adapter = new MobileAdapter();
    const client = adapter.createClient({
      url: 'ws://localhost:3000/ws',
    });

    expect(client).toBeInstanceOf(WebSocketClient);
    client.destroy();
  });
});
