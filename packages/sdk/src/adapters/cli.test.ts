import { describe, expect, it } from 'vitest';
import { WS_CAPABILITIES } from '@openaidy/shared-types';
import { WebSocketClient } from '../websocket-client.js';
import { CLIAdapter, createCLIAdapter } from './cli.js';

describe('CLIAdapter', () => {
  it('should expose cli client type', () => {
    const adapter = new CLIAdapter();
    expect(adapter.clientType).toBe('cli');
  });

  it('should include system.run default capability', () => {
    const adapter = new CLIAdapter();
    expect(adapter.getDefaultCapabilities()).toContain(
      WS_CAPABILITIES.SYSTEM_RUN,
    );
  });

  it('should resolve base URL to /ws endpoint', () => {
    const adapter = new CLIAdapter();
    expect(adapter.resolveUrl('http://localhost:3000')).toBe(
      'ws://localhost:3000/ws',
    );
  });

  it('should create websocket client instance', () => {
    const adapter = createCLIAdapter();
    const client = adapter.createClient({
      url: 'ws://localhost:3000/ws',
    });

    expect(client).toBeInstanceOf(WebSocketClient);
    client.destroy();
  });
});
