import { describe, expect, it } from 'vitest';
import { WebSocketClient } from '../websocket-client.js';
import { WebUIAdapter, createWebUIAdapter } from './web-ui.js';

describe('WebUIAdapter', () => {
  it('should expose web client type', () => {
    const adapter = new WebUIAdapter();
    expect(adapter.clientType).toBe('web');
  });

  it('should resolve http URL to websocket endpoint', () => {
    const adapter = new WebUIAdapter();
    expect(adapter.resolveUrl('http://localhost:3000')).toBe(
      'ws://localhost:3000/ws',
    );
  });

  it('should expose non-empty capability defaults', () => {
    const adapter = new WebUIAdapter();
    expect(adapter.getDefaultCapabilities().length).toBeGreaterThan(0);
  });

  it('should create websocket client instance', () => {
    const adapter = createWebUIAdapter();
    const client = adapter.createClient({
      url: 'ws://localhost:3000/ws',
    });

    expect(client).toBeInstanceOf(WebSocketClient);
    client.destroy();
  });
});
