import {
  createWebSocketClient,
  type WebSocketClient,
} from '../websocket-client.js';
import type { ClientAdapter, AdapterBaseOptions } from './types.js';
import { getDefaultCapabilitiesForClientType } from './default-capabilities.js';

export type ChannelAdapterOptions = AdapterBaseOptions & {
  bridgeId?: string;
  routeEvent?: (event: unknown) => void;
  translateInbound?: (payload: unknown) => unknown;
  translateOutbound?: (payload: unknown) => unknown;
};

export class ChannelAdapter implements ClientAdapter<ChannelAdapterOptions> {
  readonly clientType = 'channel' as const;

  createClient(options: ChannelAdapterOptions): WebSocketClient {
    // No hardcoded default. The caller must supply either `url` or `baseUrl`.
    const url =
      options.url ??
      (options.baseUrl ? this.resolveUrl(options.baseUrl) : undefined);
    if (!url) {
      throw new Error(
        'ChannelAdapter requires either `url` or `baseUrl` to be provided.',
      );
    }

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

export function createChannelAdapter(): ChannelAdapter {
  return new ChannelAdapter();
}
