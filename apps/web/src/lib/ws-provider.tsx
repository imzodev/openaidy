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
  const envUrl = import.meta.env.VITE_API_URL as string | undefined;
  if (envUrl) {
    return envUrl;
  }

  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }

  return 'http://localhost:3001';
}

// Try to get bootstrap token from the default location
async function loadBootstrapToken(): Promise<string | undefined> {
  try {
    const response = await fetch('/.openaidy/credentials/bootstrap-admin.json');
    if (response.ok) {
      const data = await response.json();
      return data.token;
    }
  } catch {
    // Token file not found or not accessible
  }
  return undefined;
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
    // Try to get token from env, otherwise load bootstrap token
    const envToken = import.meta.env.VITE_WS_TOKEN as string | undefined;
    const bootstrapToken = await loadBootstrapToken();
    const token = envToken || bootstrapToken;

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
