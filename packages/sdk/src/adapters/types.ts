import type { ClientType } from '@openaidy/shared-types';
import type { Logger } from '../websocket-client.types.js';
import type { WebSocketClient } from '../websocket-client.js';

export type AdapterBaseOptions = {
  url?: string;
  baseUrl?: string;
  token?: string;
  clientId?: string;
  clientVersion?: string;
  clientMeta?: Record<string, unknown>;
  autoReconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  heartbeatInterval?: number;
  requestTimeout?: number;
  logger?: Logger;
};

export interface ClientAdapter<TOptions = Record<string, unknown>> {
  readonly clientType: ClientType;
  createClient(options: TOptions): WebSocketClient;
  getDefaultCapabilities(): string[];
  resolveUrl(baseUrl: string): string;
  onConnect(client: WebSocketClient): Promise<void>;
  onDisconnect(client: WebSocketClient): Promise<void>;
}
