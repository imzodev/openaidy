import {
  createResource,
  createSignal,
  createEffect,
  For,
  Show,
  Switch,
  Match,
  onCleanup,
  type JSX,
} from 'solid-js';
import {
  Radio,
  Wifi,
  WifiOff,
  AlertCircle,
  CheckCircle,
  QrCode,
  Plus,
  Trash2,
  X,
  ExternalLink,
} from 'lucide-solid';
import { Layout } from './Layout';
import type { ChannelStatusResponse } from '@openaidy/shared-types';
import {
  listChannels,
  connectChannel,
  disconnectChannel,
  addWhatsAppChannel,
  addDiscordChannel,
  removeChannel,
  listAgents,
} from '../../lib/api';
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

function DocLink(props: { href: string; children: JSX.Element }) {
  return (
    <a
      href="#"
      onClick={(e) => {
        e.preventDefault();
        window.open(props.href, '_blank', 'noopener,noreferrer');
      }}
      class="mt-1 inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
    >
      <ExternalLink class="w-3 h-3" />
      {props.children}
    </a>
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

function AddChannelDialog(props: {
  onClose: () => void;
  onAdded: (id: string, type: 'whatsapp' | 'discord') => void;
}) {
  const [agents] = createResource(async () => (await listAgents()).items);
  const [channelType, setChannelType] = createSignal<'whatsapp' | 'discord'>(
    'whatsapp',
  );
  const [id, setId] = createSignal('');
  const [agentId, setAgentId] = createSignal('');
  const [allowlist, setAllowlist] = createSignal('');
  const [botToken, setBotToken] = createSignal('');
  const [dmAllowlist, setDmAllowlist] = createSignal('');
  const [channelAllowlist, setChannelAllowlist] = createSignal('');
  const [respondToMentions, setRespondToMentions] = createSignal(true);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const csv = (s: string) =>
    s
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);

  const canSave = () => {
    if (id().trim().length === 0 || agentId().length === 0) return false;
    if (channelType() === 'discord') return botToken().trim().length > 0;
    return true;
  };

  const handleSave = async () => {
    if (!canSave()) return;
    setSaving(true);
    setError(null);
    try {
      if (channelType() === 'discord') {
        const dm = csv(dmAllowlist());
        const chans = csv(channelAllowlist());
        await addDiscordChannel({
          id: id().trim(),
          agentId: agentId(),
          botToken: botToken().trim(),
          respondToMentions: respondToMentions(),
          ...(dm.length > 0 ? { dmAllowlist: dm } : {}),
          ...(chans.length > 0 ? { channelAllowlist: chans } : {}),
        });
      } else {
        const allowlistArr = csv(allowlist());
        await addWhatsAppChannel({
          id: id().trim(),
          agentId: agentId(),
          ...(allowlistArr.length > 0 ? { allowlist: allowlistArr } : {}),
        });
      }
      props.onAdded(id().trim(), channelType());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add channel');
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    'w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary';

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4">
        <div class="flex items-center justify-between p-4 border-b dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Add channel
          </h2>
          <button
            onClick={props.onClose}
            class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            aria-label="Close"
          >
            <X class="w-5 h-5" />
          </button>
        </div>

        <div class="p-4 space-y-4">
          <Show when={error()}>
            <div class="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400">
              {error()}
            </div>
          </Show>

          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Channel type <span class="text-red-500">*</span>
            </label>
            <select
              value={channelType()}
              onChange={(e) =>
                setChannelType(e.currentTarget.value as 'whatsapp' | 'discord')
              }
              class={inputClass}
            >
              <option value="whatsapp">WhatsApp</option>
              <option value="discord">Discord</option>
            </select>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Channel ID <span class="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={id()}
              onInput={(e) => setId(e.currentTarget.value)}
              placeholder="e.g. personal"
              class={inputClass}
            />
            <p class="mt-1 text-xs text-text-tertiary">
              A unique name for this connection.
            </p>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Agent <span class="text-red-500">*</span>
            </label>
            <select
              value={agentId()}
              onChange={(e) => setAgentId(e.currentTarget.value)}
              class={inputClass}
            >
              <option value="">Select an agent…</option>
              <For each={agents() ?? []}>
                {(agent) => <option value={agent.id}>{agent.name}</option>}
              </For>
            </select>
            <p class="mt-1 text-xs text-text-tertiary">
              The agent that replies to messages on this channel.
            </p>
          </div>

          <Show when={channelType() === 'whatsapp'}>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Allowlist
              </label>
              <input
                type="text"
                value={allowlist()}
                onInput={(e) => setAllowlist(e.currentTarget.value)}
                placeholder="e.g. 15551234567, 15559876543"
                class={inputClass}
              />
              <p class="mt-1 text-xs text-text-tertiary">
                Optional. Comma-separated phone numbers allowed to message this
                channel. Leave empty to allow everyone.
              </p>
            </div>
          </Show>

          <Show when={channelType() === 'discord'}>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Bot token <span class="text-red-500">*</span>
              </label>
              <input
                type="password"
                value={botToken()}
                onInput={(e) => setBotToken(e.currentTarget.value)}
                placeholder="Discord bot token"
                autocomplete="off"
                class={inputClass}
              />
              <p class="mt-1 text-xs text-text-tertiary">
                Stored encrypted at rest. Create a bot under an application,
                then copy its token from the Bot tab and enable the “Message
                Content Intent”.
              </p>
              <DocLink href="https://discord.com/developers/applications">
                Open the Discord Developer Portal
              </DocLink>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                DM allowlist
              </label>
              <input
                type="text"
                value={dmAllowlist()}
                onInput={(e) => setDmAllowlist(e.currentTarget.value)}
                placeholder="e.g. 123456789012345678"
                class={inputClass}
              />
              <p class="mt-1 text-xs text-text-tertiary">
                Optional. Comma-separated Discord user IDs allowed to DM the
                bot. Leave empty to allow all DMs.
              </p>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Server channel allowlist
              </label>
              <input
                type="text"
                value={channelAllowlist()}
                onInput={(e) => setChannelAllowlist(e.currentTarget.value)}
                placeholder="e.g. 987654321098765432"
                class={inputClass}
              />
              <p class="mt-1 text-xs text-text-tertiary">
                Optional. Comma-separated channel IDs the bot replies in (all
                messages).
              </p>
              <DocLink href="https://support.discord.com/hc/en-us/articles/206346498-Where-can-I-find-my-User-Server-Application-ID-">
                How to find Discord user & channel IDs (enable Developer Mode)
              </DocLink>
            </div>

            <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={respondToMentions()}
                onChange={(e) => setRespondToMentions(e.currentTarget.checked)}
                class="rounded border-gray-300 dark:border-gray-600 text-primary focus:ring-primary"
              />
              Reply when the bot is @mentioned in a server
            </label>
          </Show>
        </div>

        <div class="flex items-center justify-end gap-3 p-4 border-t dark:border-gray-700">
          <button
            onClick={props.onClose}
            class="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving() || !canSave()}
            class="px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            {saving() ? 'Adding…' : 'Add channel'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ChannelsPage() {
  const [channels, { refetch }] = createResource(listChannels);
  const [pending, setPending] = createSignal<string | null>(null);
  const [qrOpen, setQrOpen] = createSignal<string | null>(null);
  const [showAdd, setShowAdd] = createSignal(false);
  const [confirmRemove, setConfirmRemove] = createSignal<string | null>(null);

  const handleAdded = (id: string, type: 'whatsapp' | 'discord') => {
    setShowAdd(false);
    void refetch();
    // Jump straight into linking the freshly-added channel.
    void handleConnect(id, type);
  };

  const handleRemove = async (id: string) => {
    setPending(id);
    try {
      await removeChannel(id);
      setConfirmRemove(null);
      if (qrOpen() === id) setQrOpen(null);
      void refetch();
    } finally {
      setPending(null);
    }
  };

  const handleConnect = async (id: string, type: string) => {
    setPending(id);
    try {
      await connectChannel(id);
      // Only WhatsApp needs the QR pairing panel; Discord connects via token
      // and flips to Connected over the status WebSocket.
      if (type === 'whatsapp') setQrOpen(id);
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

  const addButton = (
    <button
      onClick={() => setShowAdd(true)}
      class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-primary hover:bg-primary/90 rounded-lg transition-colors"
    >
      <Plus class="w-4 h-4" />
      Add channel
    </button>
  );

  return (
    <Layout
      title="Channels"
      description="Connect WhatsApp, Telegram, Discord, Slack"
      actions={addButton}
    >
      <Show when={showAdd()}>
        <AddChannelDialog
          onClose={() => setShowAdd(false)}
          onAdded={handleAdded}
        />
      </Show>

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
              <p class="text-sm text-text-secondary mb-4 max-w-sm">
                Connect WhatsApp or Discord so an agent can chat with people
                there. Add a channel, then connect it.
              </p>
              <button
                onClick={() => setShowAdd(true)}
                class="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-primary/90 rounded-lg transition-colors"
              >
                <Plus class="w-4 h-4" />
                Add channel
              </button>
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
                            onClick={() =>
                              handleConnect(channel.id, channel.type)
                            }
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
                      <Show
                        when={confirmRemove() === channel.id}
                        fallback={
                          <button
                            onClick={() => setConfirmRemove(channel.id)}
                            class="inline-flex items-center gap-1 text-xs text-text-tertiary hover:text-red-500 transition-colors"
                          >
                            <Trash2 class="w-3.5 h-3.5" />
                            Remove
                          </button>
                        }
                      >
                        <div class="flex items-center gap-2">
                          <button
                            disabled={pending() === channel.id}
                            onClick={() => handleRemove(channel.id)}
                            class="text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                          >
                            {pending() === channel.id
                              ? 'Removing…'
                              : 'Confirm remove'}
                          </button>
                          <button
                            onClick={() => setConfirmRemove(null)}
                            class="text-xs text-text-tertiary hover:text-text-secondary"
                          >
                            Cancel
                          </button>
                        </div>
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
