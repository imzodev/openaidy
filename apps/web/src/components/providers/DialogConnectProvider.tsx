/**
 * Provider Connection Dialog
 *
 * Dialog for connecting to a specific provider using API key or OAuth.
 * Receives a preselected provider and shows connection options directly.
 */

import { createSignal, createEffect, Show } from 'solid-js';
import { X, Loader, ExternalLink } from 'lucide-solid';
import type { ProviderPreset } from '@openaidy/shared-types';
import {
  connectProviderWithApiKey,
  getOAuthStatus,
  getProviderAuthMethods,
  startProviderOAuth,
  type ConnectProviderResponse,
  type OAuthStartResponse,
} from '../../lib/api';

interface DialogConnectProviderProps {
  provider: ProviderPreset | null;
  onClose: () => void;
  onConnected?: (providerId: string, authMethod: string) => void;
}

export function DialogConnectProvider(props: DialogConnectProviderProps) {
  const [authMethod, setAuthMethod] = createSignal<'api_key' | 'oauth'>(
    'api_key',
  );
  const [region, setRegion] = createSignal<'global' | 'cn'>('global');
  const [apiKey, setApiKey] = createSignal('');
  const [isConnecting, setIsConnecting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [supportsOAuth, setSupportsOAuth] = createSignal(false);

  // Reset state when provider changes, then ask the server which auth
  // methods this provider actually supports — the OAuth option is only
  // ever shown once that check comes back true, so we never offer a
  // flow the backend can't complete (see fix/oauth-auth-methods-gating).
  createEffect(() => {
    const preset = props.provider;
    if (!preset) return;

    setAuthMethod('api_key');
    setRegion('global');
    setApiKey('');
    setError(null);
    setSupportsOAuth(false);

    void getProviderAuthMethods(preset.id).then((methods) => {
      if (props.provider?.id === preset.id) {
        setSupportsOAuth(methods.some((m) => m.type === 'oauth'));
      }
    });
  });

  const handleConnect = async () => {
    const preset = props.provider;
    if (!preset) return;

    if (authMethod() === 'api_key') {
      if (!apiKey()) {
        setError('API key is required');
        return;
      }
      setIsConnecting(true);
      setError(null);

      try {
        // OpenCode Go is a single subscription that exposes two
        // endpoints (/v1/chat/completions and /v1/messages) behind
        // the same API key. We register the key against BOTH
        // provider ids so the chat adapter can route to the right
        // endpoint depending on which model the user picks. If the
        // first connect succeeds and the second fails (e.g. the
        // anthropic-compatible profile isn't enabled in the
        // server), we surface the error but keep the first config
        // — the openai-compatible models would still work.
        const providerIds: string[] =
          preset.id === 'opencode-go'
            ? ['opencode-go', 'opencode-go-anthropic']
            : [preset.id];

        let lastError: string | null = null;
        let firstSuccess = false;
        for (const id of providerIds) {
          const result: ConnectProviderResponse =
            await connectProviderWithApiKey(id, apiKey());
          if (result.success) {
            firstSuccess = true;
          } else {
            lastError = result.error || `Failed to connect ${id}`;
          }
        }

        if (firstSuccess) {
          props.onConnected?.(preset.id, 'api_key');
          props.onClose();
        } else {
          setError(lastError || 'Failed to connect');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Connection failed');
      } finally {
        setIsConnecting(false);
      }
    } else if (authMethod() === 'oauth') {
      setIsConnecting(true);
      setError(null);

      try {
        // 1. Start the OAuth flow on the server. The server spawns
        //    `mmx auth login` (the official MiniMax CLI) which prints
        //    a `user_code` + verification URL. We return that URL.
        const result: OAuthStartResponse = await startProviderOAuth(preset.id, {
          region: region(),
        });

        if (!result.success || !result.flowId) {
          setError(result.error || 'Failed to start OAuth flow');
          setIsConnecting(false);
          return;
        }

        // 2. Poll the status endpoint every 2s. When mmx finishes
        //    (success or failure), the status flips to 'authorized'
        //    or 'failed' and the dialog closes.
        //
        // We do NOT open a popup from here: the `mmx` CLI (spawned
        // by the server inside a PTY) opens its own browser tab
        // using `client=MiniMax+CLI` (the only client id MiniMax
        // recognises for device-code OAuth). If we opened our own
        // popup with `client=OpenAidy`, MiniMax would reject it
        // ("Missing required parameter: user_code") because that
        // client id is not registered with MiniMax.
        //
        // We do, however, show the URL and the user_code in the
        // dialog so the user has a fallback if the popup was
        // blocked or dismissed.
        // mmx opens its own browser tab; we just poll for status.
        const flowId = result.flowId;

        // 4. Poll until authorized/failed or 10 min timeout.
        const startedAt = Date.now();
        const timeoutMs = 10 * 60 * 1000;
        let cancelled = false;

        const handleCancel = () => {
          cancelled = true;
        };

        // The "Cancel" button on the dialog sets cancelled = true
        // (see the cancel button onClick below).

        const pollOnce = async (): Promise<
          'pending' | 'authorized' | 'failed'
        > => {
          try {
            const status = await getOAuthStatus(flowId);
            if (status.ok) return status.status;
          } catch {
            // Ignore transient errors; keep polling.
          }
          return 'pending';
        };

        while (!cancelled && Date.now() - startedAt < timeoutMs) {
          const result = await pollOnce();
          if (result === 'authorized') {
            props.onConnected?.(preset.id, 'oauth');
            props.onClose();
            return;
          }
          if (result === 'failed') {
            setError('Authorization failed. Please try again.');
            setIsConnecting(false);
            return;
          }
          // pending — wait 2s and poll again
          await new Promise((r) => setTimeout(r, 2_000));
        }

        if (cancelled) {
          setError('Cancelled.');
        } else {
          setError('Timed out waiting for you to authorize. Please try again.');
        }
        setIsConnecting(false);
        // Expose handleCancel so the Cancel button can call it
        (props as unknown as { __onCancel?: () => void }).__onCancel =
          handleCancel;
        return;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'OAuth failed');
        setIsConnecting(false);
      }
    }
  };

  const handleBack = () => {
    props.onClose();
  };

  return (
    <Show when={props.provider}>
      <div class="fixed inset-0 z-50 flex items-center justify-center">
        <div
          class="absolute inset-0 bg-black/50"
          onClick={() => props.onClose()}
        />
        <div class="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4">
          {/* Header */}
          <div class="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
            <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Connect {props.provider!.name}
            </h3>
            <button
              onClick={() => props.onClose()}
              class="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <X class="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div class="p-4 space-y-4">
            {/* Provider Info */}
            <div class="p-4 rounded-lg bg-gray-50 dark:bg-gray-700/50">
              <div class="flex items-center gap-3">
                <div class="w-12 h-12 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                  <span class={`text-2xl ${props.provider!.icon}`} />
                </div>
                <div>
                  <div class="font-medium text-gray-900 dark:text-gray-100">
                    {props.provider!.name}
                  </div>
                  <div class="text-sm text-gray-500 dark:text-gray-400">
                    {props.provider!.baseUrl}
                  </div>
                </div>
              </div>
            </div>

            {/* Auth Method Selection */}
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Authentication Method
              </label>
              <div class="space-y-2">
                <label class="flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <input
                    type="radio"
                    name="authMethod"
                    value="api_key"
                    checked={authMethod() === 'api_key'}
                    onChange={() => setAuthMethod('api_key')}
                    class="text-primary"
                  />
                  <div>
                    <div class="font-medium text-gray-900 dark:text-gray-100">
                      API Key
                    </div>
                    <div class="text-xs text-gray-500 dark:text-gray-400">
                      Enter your API key directly
                    </div>
                  </div>
                </label>
                {/* OAuth is only shown for providers that actually support
                    it, per GET /providers/:id/auth-methods — surfacing it
                    for an API-key-only provider would just lead to a
                    confusing "does not support OAuth" failure. */}
                <Show when={supportsOAuth()}>
                  <label class="flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <input
                      type="radio"
                      name="authMethod"
                      value="oauth"
                      checked={authMethod() === 'oauth'}
                      onChange={() => setAuthMethod('oauth')}
                      class="text-primary"
                    />
                    <div>
                      <div class="font-medium text-gray-900 dark:text-gray-100">
                        OAuth 2.0
                      </div>
                      <div class="text-xs text-gray-500 dark:text-gray-400">
                        Authorize with your provider's OAuth flow
                      </div>
                    </div>
                  </label>
                </Show>
              </div>
            </div>

            {/* API Key Input */}
            <Show when={authMethod() === 'api_key'}>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  API Key <span class="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  value={apiKey()}
                  onInput={(e) => setApiKey(e.currentTarget.value)}
                  placeholder={`Enter ${props.provider!.name} API key`}
                  class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400"
                />
                <Show when={props.provider!.apiKeyUrl}>
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      window.open(props.provider!.apiKeyUrl, '_blank');
                    }}
                    class="inline-flex items-center gap-1 mt-2 text-sm text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    <ExternalLink class="w-3 h-3" />
                    Get an API key from {props.provider!.name}
                  </a>
                </Show>
              </div>
            </Show>

            {/* Region selector — only shown for providers that have
                region-specific endpoints (currently just MiniMax). */}
            <Show
              when={
                authMethod() === 'oauth' && props.provider!.id === 'minimax'
              }
            >
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Region
                </label>
                <div class="grid grid-cols-2 gap-2">
                  <label
                    class={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors ${
                      region() === 'global'
                        ? 'border-primary bg-primary/5'
                        : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="region"
                      value="global"
                      checked={region() === 'global'}
                      onChange={() => setRegion('global')}
                      class="text-primary"
                    />
                    <div>
                      <div class="text-sm font-medium text-gray-900 dark:text-gray-100">
                        Global
                      </div>
                      <div class="text-xs text-gray-500 dark:text-gray-400">
                        minimax.io
                      </div>
                    </div>
                  </label>
                  <label
                    class={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors ${
                      region() === 'cn'
                        ? 'border-primary bg-primary/5'
                        : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="region"
                      value="cn"
                      checked={region() === 'cn'}
                      onChange={() => setRegion('cn')}
                      class="text-primary"
                    />
                    <div>
                      <div class="text-sm font-medium text-gray-900 dark:text-gray-100">
                        China
                      </div>
                      <div class="text-xs text-gray-500 dark:text-gray-400">
                        minimaxi.com
                      </div>
                    </div>
                  </label>
                </div>
              </div>
            </Show>

            {/* OAuth Info */}
            <Show when={authMethod() === 'oauth'}>
              <div class="p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200">
                <p class="text-sm mb-3">
                  You will be redirected to {props.provider!.name}'s
                  authorization page. After granting permission, you will be
                  redirected back to complete the connection.
                </p>
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    window.open(props.provider!.documentationUrl, '_blank');
                  }}
                  class="inline-flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:underline"
                >
                  <ExternalLink class="w-3 h-3" />
                  Learn more about OAuth
                </a>
              </div>
            </Show>

            <Show when={error()}>
              <div class="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
                {error()}
              </div>
            </Show>

            <div class="flex gap-3">
              <button
                onClick={handleBack}
                class="flex-1 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConnect}
                disabled={
                  isConnecting() || (authMethod() === 'api_key' && !apiKey())
                }
                class="flex-1 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                <Show when={isConnecting()}>
                  <Loader class="w-4 h-4 animate-spin" />
                </Show>
                {isConnecting()
                  ? 'Connecting...'
                  : authMethod() === 'oauth'
                    ? 'Continue to OAuth'
                    : 'Connect'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
