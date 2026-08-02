import {
  createSignal,
  Show,
  For,
  onCleanup,
  onMount,
  createMemo,
  createEffect,
  untrack,
} from 'solid-js';
import {
  Puzzle,
  RefreshCw,
  Info,
  X,
  Shield,
  Calendar,
  Tag,
  AlertTriangle,
  Globe,
} from 'lucide-solid';
import type { AddonRecord } from '../../lib/api';
import { refreshAddonToken, getAddonAssetToken } from '../../lib/api';
import { resolveToken } from '../../lib/auth-token';
import { useTheme } from '../../lib/theme';
import {
  ADDON_THEME_TOKEN_NAMES,
  type AddonThemePayload,
} from '@openaidy/shared-types';

// Defaults to empty string (same-origin). The Vite dev proxy (dev mode)
// and the server's static handler (--integrated mode) both serve addons
// on the same origin the browser is already on, so a relative URL works.
const SERVER_BASE = import.meta.env.OPENAIDY_VITE_SERVER_URL ?? '';

/**
 * Sample the host's resolved theme — the mode the user is actually seeing
 * (after `system` collapses to light/dark) plus the resolved values of every
 * CSS custom property the host uses to drive its palette.
 *
 * Reading `getComputedStyle` is the only portable way to know the *current*
 * values: a custom-theme system, or any future override, would change the
 * variables without us knowing, and we want the addon to track the truth.
 */
function readThemeFromHost(): AddonThemePayload {
  if (typeof document === 'undefined') {
    return { mode: 'dark', tokens: {} };
  }
  const root = document.documentElement;
  const computed = getComputedStyle(root);
  const tokens: Record<string, string> = {};
  for (const name of ADDON_THEME_TOKEN_NAMES) {
    const value = computed.getPropertyValue(name).trim();
    if (value) tokens[name] = value;
  }
  const mode: AddonThemePayload['mode'] = root.classList.contains('dark')
    ? 'dark'
    : 'light';
  return { mode, tokens };
}

type Props = {
  addon: AddonRecord;
};

export function AddonViewPage(props: Props) {
  const { resolvedTheme } = useTheme();
  const manifest = () => props.addon.manifest as Record<string, unknown>;
  const ui = () => manifest().ui as Record<string, unknown> | undefined;
  const sidebar = () => ui()?.sidebar as Record<string, unknown> | undefined;
  const label = () =>
    (sidebar()?.label as string | undefined) ?? props.addon.name;

  const entry = () =>
    (manifest().entry as string | undefined) ?? 'app/index.html';
  // Asset token authenticates the sandboxed iframe's static asset loads.
  const [assetToken, setAssetToken] = createSignal<string | null>(null);
  const iframeSrc = () =>
    `${SERVER_BASE}/addons/${props.addon.addonId}/${entry()}?at=${encodeURIComponent(
      assetToken() ?? '',
    )}`;

  const [loadError, setLoadError] = createSignal(false);
  const [reloading, setReloading] = createSignal(false);
  const [showInfo, setShowInfo] = createSignal(false);
  const [cspWarnings, setCspWarnings] = createSignal<string[]>([]);
  let iframeRef: HTMLIFrameElement | undefined;

  const externalDomains = createMemo(() => {
    const d = manifest().externalDomains;
    return Array.isArray(d) ? (d as string[]) : [];
  });

  // Crypto nonce for secure iframe communication (replaces origin check)
  const nonce = crypto.randomUUID();

  // Fetch the short-lived asset token that authenticates the iframe's static
  // asset loads. The iframe only renders once it's available.
  const loadAssetToken = async () => {
    try {
      const result = await getAddonAssetToken(props.addon.addonId);
      setAssetToken(result.token);
    } catch {
      setLoadError(true);
    }
  };

  // Auto-fetch addon token if missing (e.g. addon was enabled by CLI, not the UI)
  onMount(async () => {
    void loadAssetToken();

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
    // The asset token may have expired since the last load — refresh it.
    void loadAssetToken();
    setTimeout(() => setReloading(false), 50);
  };

  // The iframe never receives the user's auth token — it's a sandboxed,
  // opaque-origin context that can run arbitrary (including LLM-generated)
  // script, so anything posted into it must be assumed readable by the
  // addon itself. All authenticated calls the addon triggers are proxied by
  // this component (see handleMessage below) using a short-lived,
  // addon-scoped token that never crosses into the iframe.
  //
  // The host's current theme (mode + the resolved CSS variable values) is
  // included on init so an addon that mirrors the host's palette is correct
  // on first paint, with no flash. See OPENAIDY_THEME_CHANGED below for the
  // live-update path.
  const sendInit = () => {
    iframeRef?.contentWindow?.postMessage(
      {
        type: 'OPENAIDY_INIT',
        apiBase: SERVER_BASE,
        nonce,
        theme: readThemeFromHost(),
      },
      '*',
    );
  };

  // Live theme propagation. When the user toggles light/dark (or the OS
  // preference changes for `system` mode), the host's `<html>` class flips
  // and the CSS variables resolve to the new palette. We re-sample the host
  // and post OPENAIDY_THEME_CHANGED so a theme-aware addon follows without
  // needing a reload. untrack the read on first run — the first init already
  // carries the theme, so we only want to push deltas.
  createEffect(() => {
    resolvedTheme();
    const theme = readThemeFromHost();
    untrack(() => {
      iframeRef?.contentWindow?.postMessage(
        { type: 'OPENAIDY_THEME_CHANGED', theme },
        '*',
      );
    });
  });

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
    // The sandboxed iframe has an opaque origin, so `event.origin` can't be
    // checked. Compare `event.source` — the iframe's actual window object —
    // instead: this rejects messages from any other frame/tab up front, for
    // every message type, including ADDON_READY (which necessarily arrives
    // before the addon has a nonce to echo back).
    if (event.source !== iframeRef?.contentWindow) return;
    const msg = event.data as Record<string, unknown>;
    if (typeof msg !== 'object') return;
    // Addon signals it is ready to receive OPENAIDY_INIT (timing safety)
    if (msg.type === 'ADDON_READY') {
      sendInit();
      return;
    }
    if (msg.type === 'ADDON_CSP_VIOLATION') {
      if (msg.nonce !== nonce) return;
      const blocked = msg.blockedURI as string | undefined;
      if (!blocked) return;
      try {
        const host = new URL(blocked).hostname;
        setCspWarnings((prev) =>
          prev.includes(host) ? prev : [...prev, host],
        );
      } catch {
        setCspWarnings((prev) =>
          prev.includes(blocked) ? prev : [...prev, blocked],
        );
      }
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

    // Every allowed path is an addon-proxy route (see ALLOWED_ROUTES above),
    // so this always requires the short-lived, addon-scoped token — never
    // the user's own auth token. Fail closed if it's missing; there is no
    // fallback to a broader credential.
    const addonToken = localStorage.getItem(
      `openaidy_addon_token:${props.addon.addonId}`,
    );

    if (!addonToken) {
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

    try {
      const res = await fetch(`${SERVER_BASE}${reqPath}`, {
        method: method ?? 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${addonToken}`,
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

  onCleanup(() => {
    window.removeEventListener('message', handleMessage);
  });

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

      {/* CSP warning banner */}
      <Show when={cspWarnings().length > 0}>
        <div class="flex items-start gap-2 px-4 py-2.5 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs">
          <AlertTriangle class="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <div class="flex-1 min-w-0">
            <span class="font-medium">CSP bloqueó peticiones a: </span>
            <For each={cspWarnings()}>
              {(host) => (
                <code class="ml-1 px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 font-mono">
                  {host}
                </code>
              )}
            </For>
            <span class="ml-1">
              — agrega <code class="font-mono">externalDomains</code> al{' '}
              <code class="font-mono">addon.json</code> y recarga.
            </span>
          </div>
          <button
            onClick={() => setCspWarnings([])}
            class="flex-shrink-0 text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200"
          >
            ×
          </button>
        </div>
      </Show>

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

              <div>
                <p class="text-sm font-medium text-text-secondary mb-2 flex items-center gap-1.5">
                  <Globe class="w-3.5 h-3.5" />
                  External Domains
                </p>
                <Show when={externalDomains().length > 0}>
                  <div class="flex flex-wrap gap-1.5">
                    <For each={externalDomains()}>
                      {(domain) => (
                        <span class="inline-flex items-center px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-900/30 text-xs font-mono text-blue-700 dark:text-blue-300">
                          {domain}
                        </span>
                      )}
                    </For>
                  </div>
                </Show>
                <Show when={externalDomains().length === 0}>
                  <p class="text-xs text-text-tertiary">
                    None declared — fetch() to external URLs will be blocked by
                    CSP.
                  </p>
                </Show>
              </div>
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

      {/* Addon iframe — sandbox blocks localStorage/cookie access from addon.
          Gated on the asset token so the iframe URL always carries it. */}
      <Show when={!loadError() && !reloading() && assetToken()}>
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
