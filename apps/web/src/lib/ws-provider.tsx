import {
  createContext,
  createSignal,
  onCleanup,
  onMount,
  type Accessor,
  useContext,
  type ParentComponent,
} from 'solid-js';
import {
  createWebUIAdapter,
  type PresenceChangedEvent,
  type PresenceStatus,
  type WebSocketClient,
  type WebSocketClientState,
} from '@openaidy/sdk';
import { setWebSocketApiClient } from './ws-api';
import { resolveToken } from './auth-token';
import { API_BASE } from './api';

export type PresenceEntry = {
  clientId: string;
  status: PresenceStatus;
  metadata?: Record<string, unknown>;
};

type WebSocketContextValue = {
  client: Accessor<WebSocketClient | null>;
  state: Accessor<WebSocketClientState>;
  isConnected: Accessor<boolean>;
  error: Accessor<string | undefined>;
  presence: Accessor<PresenceEntry[]>;
  updatePresence: (
    status: PresenceStatus,
    metadata?: Record<string, unknown>,
  ) => Promise<void>;
};

const WebSocketContext = createContext<WebSocketContextValue>();

function resolveBaseUrl(): string {
  // Single source of truth for the WS endpoint. Empty/unset means
  // same-origin in dev mode (Vite proxies /ws) or --integrated mode
  // (server serves the built bundle same-origin). The browser requires
  // an absolute WebSocket URL, so we construct one from window.location.
  const wsUrl = import.meta.env.OPENAIDY_VITE_WS_URL;
  if (wsUrl) return wsUrl;
  // Desktop (Tauri): API_BASE gets resolved at runtime to the core
  // service's actual http(s)://127.0.0.1:<port> origin, which is never
  // the page's own origin there (the webview serves from a tauri://
  // pseudo-origin) — reuse it rather than window.location so this stays
  // one source of truth with the HTTP API.
  if (API_BASE) {
    return API_BASE.replace(/^http/, 'ws') + '/ws';
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

export const WebSocketProvider: ParentComponent = (props) => {
  const [client, setClient] = createSignal<WebSocketClient | null>(null);
  const [state, setState] = createSignal<WebSocketClientState>('disconnected');
  const [error, setError] = createSignal<string | undefined>(undefined);
  const [presence, setPresence] = createSignal<PresenceEntry[]>([]);

  // Handler for presence changes from other clients
  const handlePresenceChange = (event: PresenceChangedEvent) => {
    setPresence((prev) => {
      const filtered = prev.filter((p) => p.clientId !== event.clientId);
      if (event.status !== 'offline') {
        return [
          ...filtered,
          {
            clientId: event.clientId,
            status: event.status,
            metadata: event.metadata,
          },
        ];
      }
      return filtered;
    });
  };

  // Update local presence status
  const updatePresenceStatus = async (
    newStatus: 'online' | 'away' | 'busy' | 'offline',
    metadata?: Record<string, unknown>,
  ) => {
    const wsClient = client();
    if (!wsClient) return;

    try {
      await wsClient.updatePresence(newStatus, metadata);
      // Optimistically update local presence - use connectionId from client
      // The connectionId is set after authentication
    } catch (err) {
      console.error('Failed to update presence:', err);
    }
  };

  onMount(async () => {
    // Resolve token: URL param → localStorage → env fallback
    const envToken = import.meta.env.VITE_WS_TOKEN as string | undefined;
    const token = envToken || resolveToken();

    const adapter = createWebUIAdapter();
    const wsClient = adapter.createClient({
      baseUrl: resolveBaseUrl(),
      token: token,
      clientVersion:
        (import.meta.env.VITE_APP_VERSION as string | undefined) ?? 'web-dev',
      clientMeta: {
        runtime: 'solidjs',
      },
    });

    setClient(wsClient);
    setWebSocketApiClient(wsClient);

    const unsubscribeState = wsClient.onStateChange(
      (nextState: WebSocketClientState) => {
        setState(nextState);
      },
    );

    const unsubscribeError = wsClient.onError((wsError: Error) => {
      setError(wsError.message);
    });

    // Subscribe to presence changes
    const unsubscribePresence = wsClient.on<PresenceChangedEvent>(
      'presence.changed',
      handlePresenceChange,
    );

    void wsClient.connect().catch((connectError: Error) => {
      setError(connectError.message);
    });

    onCleanup(() => {
      unsubscribeState();
      unsubscribeError();
      unsubscribePresence();
      wsClient.destroy();
      setWebSocketApiClient(null);
      setClient(null);
    });
  });

  return (
    <WebSocketContext.Provider
      value={{
        client,
        state,
        isConnected: () => state() === 'connected',
        error,
        presence,
        updatePresence: updatePresenceStatus,
      }}
    >
      {props.children}
    </WebSocketContext.Provider>
  );
};

export function useWebSocketContext(): WebSocketContextValue {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error(
      'useWebSocketContext must be used within WebSocketProvider',
    );
  }
  return context;
}
