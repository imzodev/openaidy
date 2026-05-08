import {
  createResource,
  createSignal,
  createEffect,
  For,
  Show,
  Switch,
  Match,
  onCleanup,
} from 'solid-js';
import {
  Radio,
  Wifi,
  WifiOff,
  AlertCircle,
  CheckCircle,
  QrCode,
} from 'lucide-solid';
import { Layout } from './Layout';
import type { ChannelStatusResponse } from '@openaidy/shared-types';
import { listChannels, connectChannel, disconnectChannel } from '../../lib/api';
import { useWebSocketContext } from '../../lib/ws-provider';

function StatusBadge(props: { status: ChannelStatusResponse['status'] }) {
  return (
    <Switch>
      <Match when={props.status === 'connected'}>
        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
          <CheckCircle class="w-3.5 h-3.5" />
          Connected
        </span>
      </Match>
      <Match when={props.status === 'qr'}>
        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400">
          <QrCode class="w-3.5 h-3.5" />
          Scan QR
        </span>
      </Match>
      <Match when={props.status === 'disconnected'}>
        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
          <WifiOff class="w-3.5 h-3.5" />
          Disconnected
        </span>
      </Match>
      <Match when={props.status === 'error'}>
        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">
          <AlertCircle class="w-3.5 h-3.5" />
          Error
        </span>
      </Match>
    </Switch>
  );
}

function QrPanel(props: { channelId: string; onConnected: () => void }) {
  const [qr, setQr] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [connected, setConnected] = createSignal(false);

  const wsContext = useWebSocketContext();

  // Subscribe to channel events when component mounts
  onCleanup(() => {
    const client = wsContext.client();
    if (client && !connected()) {
      // Unsubscribe from channel events
      client.send({
        type: 'channel.unsubscribe',
        payload: { channelId: props.channelId },
      } as never);
    }
  });

  // Watch for WebSocket connection and subscribe to channel events
  createEffect(() => {
    const client = wsContext.client();
    console.log(
      '[QrPanel] createEffect run, client:',
      !!client,
      'connected:',
      connected(),
    );
    if (!client || connected()) return;

    // Subscribe to QR events
    const unsubQr = client.on('channel.qr', (msg: unknown) => {
      console.log('[QrPanel] Received channel.qr event:', msg);
      const wsMsg = msg as { payload: { channelId: string; qr: string } };
      if (wsMsg.payload.channelId === props.channelId) {
        setQr(wsMsg.payload.qr);
      }
    });

    // Subscribe to status events
    const unsubStatus = client.on('channel.status', (msg: unknown) => {
      console.log('[QrPanel] Received channel.status event:', msg);
      const wsMsg = msg as { payload: { channelId: string; status: string } };
      if (wsMsg.payload.channelId === props.channelId) {
        if (wsMsg.payload.status === 'connected') {
          setConnected(true);
          props.onConnected();
        }
        if (wsMsg.payload.status === 'error') {
          setError('Connection error');
        }
      }
    });

    // Send subscribe request (fire and forget)
    console.log('[QrPanel] Sending channel.subscribe for:', props.channelId);
    void client.sendRequest('channel.subscribe', {
      channelId: props.channelId,
    });

    onCleanup(() => {
      unsubQr();
      unsubStatus();
      void client.sendRequest('channel.unsubscribe', {
        channelId: props.channelId,
      });
    });
  });

  return (
    <div class="mt-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
      <p class="text-sm text-text-secondary mb-3">
        Open WhatsApp → Linked Devices → Link a Device, then scan this code.
      </p>
      <Show when={error()}>
        <p class="text-sm text-red-500 mb-2">{error()}</p>
      </Show>
      <Show
        when={qr()}
        fallback={
          <p class="text-sm text-text-tertiary">Generating QR code...</p>
        }
      >
        {(q) => (
          <img
            src={`data:image/png;base64,${q()}`}
            alt="WhatsApp QR Code"
            class="w-52 h-52 border rounded"
          />
        )}
      </Show>
    </div>
  );
}

export function ChannelsPage() {
  const [channels, { refetch }] = createResource(listChannels);
  const [pending, setPending] = createSignal<string | null>(null);
  const [qrOpen, setQrOpen] = createSignal<string | null>(null);

  const handleConnect = async (id: string) => {
    setPending(id);
    try {
      await connectChannel(id);
      setQrOpen(id);
    } catch {
      // connect error — QR panel won't open, user can retry
    } finally {
      setPending(null);
    }
  };

  const handleDisconnect = async (id: string) => {
    setPending(id);
    try {
      await disconnectChannel(id);
      setQrOpen(null);
      void refetch();
    } finally {
      setPending(null);
    }
  };

  return (
    <Layout
      title="Channels"
      description="Connect WhatsApp, Telegram, Discord, Slack"
    >
      <Show when={channels.loading}>
        <div class="flex items-center justify-center h-48">
          <p class="text-text-tertiary">Loading channels...</p>
        </div>
      </Show>

      <Show when={channels.error}>
        <div class="mb-4 p-4 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded-lg text-sm">
          Failed to load channels: {channels.error.message}
        </div>
      </Show>

      <Show when={!channels.loading && !channels.error}>
        <Show
          when={channels()?.length}
          fallback={
            <div class="flex flex-col items-center justify-center h-64 text-center">
              <Radio class="w-12 h-12 text-text-muted mb-4" />
              <h3 class="text-lg font-medium text-text-primary mb-2">
                No channels configured
              </h3>
              <p class="text-sm text-text-secondary mb-4">
                Add a channel to{' '}
                <code class="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-xs font-mono">
                  openaidy.json
                </code>{' '}
                to get started.
              </p>
              <pre class="text-xs text-left bg-gray-100 dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-700 text-text-secondary font-mono">{`"channels": [
  {
    "type": "whatsapp",
    "id": "personal",
    "agentId": "my-agent",
    "enabled": true
  }
]`}</pre>
            </div>
          }
        >
          <div class="grid gap-4">
            <For each={channels()}>
              {(channel) => (
                <div class="border border-gray-200 dark:border-gray-700 rounded-lg p-5 bg-white dark:bg-gray-800 shadow-sm">
                  <div class="flex items-start justify-between gap-4">
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2">
                        <h2 class="font-semibold text-text-primary truncate">
                          {channel.id}
                        </h2>
                        <span class="px-2 py-0.5 text-xs rounded bg-gray-100 dark:bg-gray-700 text-text-secondary font-mono">
                          {channel.type}
                        </span>
                      </div>
                      <div class="flex items-center gap-3 mt-1.5 text-sm text-text-tertiary">
                        <span class="inline-flex items-center gap-1">
                          <Wifi class="w-3.5 h-3.5" />
                          Agent:{' '}
                          <code class="text-xs font-mono bg-gray-100 dark:bg-gray-700 px-1 py-0.5 rounded">
                            {channel.agentId}
                          </code>
                        </span>
                        <Show when={channel.connectedAt}>
                          <span class="text-xs">
                            Connected{' '}
                            {new Date(channel.connectedAt!).toLocaleString()}
                          </span>
                        </Show>
                      </div>
                      <Show when={channel.status === 'error' && channel.error}>
                        <p class="mt-2 text-xs text-red-500">{channel.error}</p>
                      </Show>
                    </div>
                    <div class="flex flex-col items-end gap-3 flex-shrink-0">
                      <StatusBadge status={channel.status} />
                      <Show
                        when={channel.status === 'connected'}
                        fallback={
                          <button
                            disabled={pending() === channel.id}
                            onClick={() => handleConnect(channel.id)}
                            class="px-3 py-1.5 text-sm font-medium text-white bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
                          >
                            {pending() === channel.id
                              ? 'Connecting...'
                              : 'Connect'}
                          </button>
                        }
                      >
                        <button
                          disabled={pending() === channel.id}
                          onClick={() => handleDisconnect(channel.id)}
                          class="px-3 py-1.5 text-sm font-medium text-white bg-gray-500 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
                        >
                          {pending() === channel.id
                            ? 'Disconnecting...'
                            : 'Disconnect'}
                        </button>
                      </Show>
                    </div>
                  </div>

                  <Show when={qrOpen() === channel.id}>
                    <QrPanel
                      channelId={channel.id}
                      onConnected={() => {
                        setQrOpen(null);
                        void refetch();
                      }}
                    />
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </Layout>
  );
}
