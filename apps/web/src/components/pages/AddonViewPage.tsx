import { createSignal, Show, onCleanup } from 'solid-js';
import { Puzzle, RefreshCw } from 'lucide-solid';
import type { AddonRecord } from '../../lib/api';
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

  const iframeSrc = () =>
    `${SERVER_BASE}/addons/${props.addon.addonId}/index.html`;

  const [loadError, setLoadError] = createSignal(false);
  const [reloading, setReloading] = createSignal(false);
  let iframeRef: HTMLIFrameElement | undefined;

  // Crypto nonce for secure iframe communication (replaces origin check)
  const nonce = crypto.randomUUID();

  const handleReload = () => {
    setLoadError(false);
    setReloading(true);
    setTimeout(() => setReloading(false), 50);
  };

  // Inject token when iframe finishes loading
  const handleLoad = () => {
    const token = resolveToken();
    iframeRef?.contentWindow?.postMessage(
      {
        type: 'OPENAIDY_INIT',
        token,
        apiBase: SERVER_BASE,
        nonce,
      },
      '*',
    );
  };

  // Bridge: proxy API requests from the iframe to the real backend
  const handleMessage = async (event: MessageEvent) => {
    const msg = event.data as Record<string, unknown>;
    if (typeof msg !== 'object' || msg.type !== 'OPENAIDY_REQUEST') return;
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

    const token = resolveToken();
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
        <button
          onClick={handleReload}
          class="p-1.5 rounded-lg text-text-tertiary hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          title="Reload"
        >
          <RefreshCw class="w-4 h-4" />
        </button>
      </div>

      {/* Error state */}
      <Show when={loadError()}>
        <div class="flex flex-col items-center justify-center flex-1 text-center p-8">
          <Puzzle class="w-10 h-10 text-text-tertiary mb-3" />
          <p class="text-text-secondary font-medium mb-1">
            Could not load addon UI
          </p>
          <p class="text-sm text-text-tertiary max-w-sm">
            Make sure you have run{' '}
            <code class="font-mono bg-gray-100 dark:bg-gray-800 px-1 rounded">
              pnpm openaidy addon build
            </code>{' '}
            to compile the addon.
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
