import {
  createWebSocketClient,
  type WebSocketClient,
} from '../websocket-client.js';
import type { ClientAdapter, AdapterBaseOptions } from './types.js';
import { getDefaultCapabilitiesForClientType } from './default-capabilities.js';

export type WebUIAdapterOptions = AdapterBaseOptions & {
  visibilityAwarePresence?: boolean;
};

export class WebUIAdapter implements ClientAdapter<WebUIAdapterOptions> {
  readonly clientType = 'web' as const;

  createClient(options: WebUIAdapterOptions): WebSocketClient {
    const url =
      options.url ??
      this.resolveUrl(options.baseUrl ?? this.getDefaultBaseUrl());

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
    } else if (!parsed.pathname.endsWith('/ws')) {
      parsed.pathname = `${parsed.pathname.replace(/\/$/, '')}/ws`;
    }

    return parsed.toString();
  }

  async onConnect(_client: WebSocketClient): Promise<void> {}

  async onDisconnect(_client: WebSocketClient): Promise<void> {}

  private getDefaultBaseUrl(): string {
    if (typeof window !== 'undefined' && window.location?.origin) {
      return window.location.origin;
    }

    return 'http://localhost:3000';
  }
}

export function createWebUIAdapter(): WebUIAdapter {
  return new WebUIAdapter();
}
