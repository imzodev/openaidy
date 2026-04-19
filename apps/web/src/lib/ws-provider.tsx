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
  // Priority 1: Single server URL via env var (for local dev or custom deployments)
  const serverUrl = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (serverUrl) {
    return serverUrl;
  }

  // Priority 2: In development, connect to the backend server (3001)
  if (import.meta.env.DEV) {
    return 'http://localhost:3001';
  }

  // Priority 3: In production, use the frontend origin (handles custom domains)
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }

  // Fallback for development
  return 'http://localhost:3001';
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
