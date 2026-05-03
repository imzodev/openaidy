import { createSignal, Show, For, onCleanup, onMount } from 'solid-js';
import {
  Puzzle,
  RefreshCw,
  Info,
  X,
  Shield,
  Calendar,
  Tag,
} from 'lucide-solid';
import type { AddonRecord } from '../../lib/api';
import { refreshAddonToken } from '../../lib/api';
import { resolveToken } from '../../lib/auth-token';

const SERVER_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

type Props = {
  addon: AddonRecord;
};

export function AddonViewPage(props: Props) {
  const manifest = () => props.addon.manifest as Record<string, unknown>;
  const ui = () => manifest().ui as Record<string, unknown> | undefined;
  const sidebar = () => ui()?.sidebar as Record<string, unknown> | undefined;
  const label = () =>
    (sidebar()?.label as string | undefined) ?? props.addon.name;

  const entry = () =>
    (manifest().entry as string | undefined) ?? 'app/index.html';
  const iframeSrc = () =>
    `${SERVER_BASE}/addons/${props.addon.addonId}/${entry()}`;

  const [loadError, setLoadError] = createSignal(false);
  const [reloading, setReloading] = createSignal(false);
  const [showInfo, setShowInfo] = createSignal(false);
  let iframeRef: HTMLIFrameElement | undefined;

  // Crypto nonce for secure iframe communication (replaces origin check)
  const nonce = crypto.randomUUID();

  // Auto-fetch addon token if missing (e.g. addon was enabled by CLI, not the UI)
  onMount(async () => {
    const key = `openaidy_addon_token:${props.addon.addonId}`;
    if (!localStorage.getItem(key)) {
      try {
        const userToken = resolveToken();
        if (!userToken) return;
        const result = await refreshAddonToken(userToken, props.addon.addonId);
        localStorage.setItem(key, result.accessToken);
      } catch {
        // Non-fatal — proxy routes will fail with a clear message if still missing
      }
    }
  });

  const handleReload = () => {
    setLoadError(false);
    setReloading(true);
    setTimeout(() => setReloading(false), 50);
  };

  const sendInit = () => {
    const token = resolveToken();
    iframeRef?.contentWindow?.postMessage(
      { type: 'OPENAIDY_INIT', token, apiBase: SERVER_BASE, nonce },
      '*',
    );
  };

  // Send on iframe load as a fallback for addons that predate ADDON_READY,
  // and again when the addon sends ADDON_READY (see handleMessage) for reliability.
  // Receiving OPENAIDY_INIT twice is safe — the SDK clears callbacks after the first.
  const handleLoad = () => sendInit();

  // Allowlist of paths the addon proxy may forward (method + path regex)
  const ALLOWED_ROUTES: { methods: string[]; pattern: RegExp }[] = [
    {
      methods: ['GET', 'POST', 'DELETE', 'PATCH', 'PUT'],
      pattern: /^\/api\/addon-proxy\//,
    },
  ];

  const isAllowed = (method: string, path: string) =>
    ALLOWED_ROUTES.some(
      (r) => r.methods.includes(method.toUpperCase()) && r.pattern.test(path),
    );

  // Bridge: proxy API requests from the iframe to the real backend
  const handleMessage = async (event: MessageEvent) => {
    const msg = event.data as Record<string, unknown>;
    if (typeof msg !== 'object') return;
    // Addon signals it is ready to receive OPENAIDY_INIT (timing safety)
    if (msg.type === 'ADDON_READY') {
      sendInit();
      return;
    }
    if (msg.type !== 'OPENAIDY_REQUEST') return;
    // Validate nonce instead of origin (sandbox strips origin to 'null')
    if (msg.nonce !== nonce) return;

    const {
      requestId,
      method,
      path: reqPath,
      body,
    } = msg as {
      requestId: string;
      method: string;
      path: string;
      body?: unknown;
    };

    // Reject requests to paths not in the allowlist
    if (!isAllowed(method ?? 'GET', reqPath)) {
      iframeRef?.contentWindow?.postMessage(
        {
          type: 'OPENAIDY_RESPONSE',
          requestId,
          ok: false,
          status: 403,
          error: `Addon proxy: ${method} ${reqPath} is not allowed`,
        },
        '*',
      );
      return;
    }

    // Use addon-scoped token for addon-proxy routes, user token for everything else
    const isAddonProxy = reqPath.startsWith('/api/addon-proxy/');
    const addonToken = localStorage.getItem(
      `openaidy_addon_token:${props.addon.addonId}`,
    );

    if (isAddonProxy && !addonToken) {
      iframeRef?.contentWindow?.postMessage(
        {
          type: 'OPENAIDY_RESPONSE',
          requestId,
          ok: false,
          status: 401,
          error:
            'Addon token not found. Disable and re-enable the addon to refresh it.',
        },
        '*',
      );
      return;
    }

    const token = isAddonProxy ? addonToken : resolveToken();
    try {
      const res = await fetch(`${SERVER_BASE}${reqPath}`, {
        method: method ?? 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const data: unknown = res.headers.get('content-type')?.includes('json')
        ? await res.json()
        : await res.text();
      iframeRef?.contentWindow?.postMessage(
        {
          type: 'OPENAIDY_RESPONSE',
          requestId,
          ok: res.ok,
          status: res.status,
          data,
        },
        '*',
      );
    } catch (err) {
      iframeRef?.contentWindow?.postMessage(
        {
          type: 'OPENAIDY_RESPONSE',
          requestId,
          ok: false,
          status: 0,
          error: String(err),
        },
        '*',
      );
    }
  };

  window.addEventListener('message', handleMessage);
  onCleanup(() => window.removeEventListener('message', handleMessage));

  return (
    <div class="flex flex-col h-full">
      {/* Header bar */}
      <div class="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex-shrink-0">
        <div>
          <h1 class="text-base font-semibold text-text-primary">{label()}</h1>
          <p class="text-xs text-text-tertiary">
            Addon · v{props.addon.version}
          </p>
        </div>
        <div class="flex items-center gap-1">
          <button
            onClick={() => setShowInfo(true)}
            class="p-1.5 rounded-lg text-text-tertiary hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title="Addon info"
          >
            <Info class="w-4 h-4" />
          </button>
          <button
            onClick={handleReload}
            class="p-1.5 rounded-lg text-text-tertiary hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title="Reload"
          >
            <RefreshCw class="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Info modal */}
      <Show when={showInfo()}>
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowInfo(false)}
        >
          <div
            class="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md mx-4 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div class="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 class="text-lg font-semibold text-text-primary">
                Addon Details
              </h2>
              <button
                onClick={() => setShowInfo(false)}
                class="p-1 rounded-lg text-text-tertiary hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <X class="w-4 h-4" />
              </button>
            </div>
            <div class="px-5 py-4 space-y-4">
              <div>
                <h3 class="text-xl font-bold text-text-primary">
                  {props.addon.name}
                </h3>
                <Show when={props.addon.description}>
                  <p class="text-sm text-text-secondary mt-1">
                    {props.addon.description}
                  </p>
                </Show>
              </div>

              <div class="grid grid-cols-2 gap-3 text-sm">
                <div class="flex items-center gap-2 text-text-secondary">
                  <Tag class="w-3.5 h-3.5" />
                  <span>Version</span>
                </div>
                <span class="text-text-primary font-medium">
                  v{props.addon.version}
                </span>

                <div class="flex items-center gap-2 text-text-secondary">
                  <span class="w-3.5 h-3.5 text-center text-xs">ID</span>
                  <span>Addon ID</span>
                </div>
                <span class="text-text-primary font-mono text-xs">
                  {props.addon.addonId}
                </span>

                <div class="flex items-center gap-2 text-text-secondary">
                  <Calendar class="w-3.5 h-3.5" />
                  <span>Installed</span>
                </div>
                <span class="text-text-primary">
                  {new Date(props.addon.installedAt).toLocaleDateString()}
                </span>

                <div class="flex items-center gap-2 text-text-secondary">
                  <Shield class="w-3.5 h-3.5" />
                  <span>Status</span>
                </div>
                <span
                  class={`font-medium ${
                    props.addon.status === 'enabled'
                      ? 'text-green-600 dark:text-green-400'
                      : props.addon.status === 'error'
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-text-tertiary'
                  }`}
                >
                  {props.addon.status.charAt(0).toUpperCase() +
                    props.addon.status.slice(1)}
                </span>
              </div>

              <Show when={(props.addon.permissions ?? []).length > 0}>
                <div>
                  <p class="text-sm font-medium text-text-secondary mb-2">
                    Permissions
                  </p>
                  <div class="flex flex-wrap gap-1.5">
                    <For each={props.addon.permissions}>
                      {(perm) => (
                        <span class="inline-flex items-center px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-700 text-xs font-mono text-text-secondary">
                          {perm}
                        </span>
                      )}
                    </For>
                  </div>
                </div>
              </Show>

              <Show when={(props.addon.permissions ?? []).length === 0}>
                <div>
                  <p class="text-sm font-medium text-text-secondary mb-1">
                    Permissions
                  </p>
                  <p class="text-xs text-text-tertiary">
                    No permissions declared
                  </p>
                </div>
              </Show>
            </div>
          </div>
        </div>
      </Show>

      {/* Error state */}
      <Show when={loadError()}>
        <div class="flex flex-col items-center justify-center flex-1 text-center p-8">
          <Puzzle class="w-10 h-10 text-text-tertiary mb-3" />
          <p class="text-text-secondary font-medium mb-1">
            Could not load addon UI
          </p>
          <p class="text-sm text-text-tertiary max-w-sm">
            Make sure the addon files exist at{' '}
            <code class="font-mono bg-gray-100 dark:bg-gray-800 px-1 rounded">
              .openaidy/addons/{props.addon.addonId}/
            </code>
          </p>
        </div>
      </Show>

      {/* Addon iframe — sandbox blocks localStorage/cookie access from addon */}
      <Show when={!loadError() && !reloading()}>
        <iframe
          ref={iframeRef}
          src={iframeSrc()}
          class="flex-1 w-full border-0"
          title={label()}
          onLoad={handleLoad}
          onError={() => setLoadError(true)}
          sandbox="allow-scripts allow-forms"
        />
      </Show>
    </div>
  );
}
