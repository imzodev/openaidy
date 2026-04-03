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
  type WebSocketClient,
  type WebSocketClientState,
} from '@openaidy/sdk';
import { setWebSocketApiClient } from './ws-api';

type WebSocketContextValue = {
  client: Accessor<WebSocketClient | null>;
  state: Accessor<WebSocketClientState>;
  isConnected: Accessor<boolean>;
  error: Accessor<string | undefined>;
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

export const WebSocketProvider: ParentComponent = (props) => {
  const [client, setClient] = createSignal<WebSocketClient | null>(null);
  const [state, setState] = createSignal<WebSocketClientState>('disconnected');
  const [error, setError] = createSignal<string | undefined>(undefined);

  onMount(() => {
    const adapter = createWebUIAdapter();
    const wsClient = adapter.createClient({
      baseUrl: resolveBaseUrl(),
      token: import.meta.env.VITE_WS_TOKEN as string | undefined,
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

    void wsClient.connect().catch((connectError: Error) => {
      setError(connectError.message);
    });

    onCleanup(() => {
      unsubscribeState();
      unsubscribeError();
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
