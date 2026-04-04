import {
  createWebSocketClient,
  type WebSocketClient,
} from '../websocket-client.js';
import type { ClientAdapter, AdapterBaseOptions } from './types.js';
import { getDefaultCapabilitiesForClientType } from './default-capabilities.js';

export type MobileAdapterOptions = AdapterBaseOptions & {
  wsImplementation?: typeof WebSocket;
  onAppForeground?: () => void;
  onAppBackground?: () => void;
};

export class MobileAdapter implements ClientAdapter<MobileAdapterOptions> {
  readonly clientType = 'mobile' as const;

  createClient(options: MobileAdapterOptions): WebSocketClient {
    const url =
      options.url ??
      this.resolveUrl(options.baseUrl ?? 'ws://localhost:3000/ws');

    return createWebSocketClient({
      url,
      ...(options.token ? { token: options.token } : {}),
      ...(options.clientId ? { clientId: options.clientId } : {}),
      clientType: this.clientType,
      ...(options.clientVersion
        ? { clientVersion: options.clientVersion }
        : {}),
      ...(options.clientMeta ? { clientMeta: options.clientMeta } : {}),
      ...(options.autoReconnect !== undefined
        ? { autoReconnect: options.autoReconnect }
        : {}),
      ...(options.reconnectInterval !== undefined
        ? { reconnectInterval: options.reconnectInterval }
        : {}),
      ...(options.maxReconnectAttempts !== undefined
        ? { maxReconnectAttempts: options.maxReconnectAttempts }
        : {}),
      ...(options.heartbeatInterval !== undefined
        ? { heartbeatInterval: options.heartbeatInterval }
        : {}),
      ...(options.requestTimeout !== undefined
        ? { requestTimeout: options.requestTimeout }
        : {}),
      ...(options.logger ? { logger: options.logger } : {}),
    });
  }

  getDefaultCapabilities(): string[] {
    return getDefaultCapabilitiesForClientType(this.clientType);
  }

  resolveUrl(baseUrl: string): string {
    const parsed = new URL(baseUrl);
    if (parsed.protocol === 'http:') {
      parsed.protocol = 'ws:';
    } else if (parsed.protocol === 'https:') {
      parsed.protocol = 'wss:';
    }
    if (parsed.pathname === '/' || parsed.pathname === '') {
      parsed.pathname = '/ws';
    }
    return parsed.toString();
  }

  async onConnect(_client: WebSocketClient): Promise<void> {}

  async onDisconnect(_client: WebSocketClient): Promise<void> {}
}

export function createMobileAdapter(): MobileAdapter {
  return new MobileAdapter();
}
