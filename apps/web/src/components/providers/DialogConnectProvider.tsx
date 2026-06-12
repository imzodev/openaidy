/**
 * Provider Connection Dialog
 *
 * Dialog for connecting to a specific provider using API key or OAuth.
 * Receives a preselected provider and shows connection options directly.
 */

import { createSignal, createEffect, Show } from 'solid-js';
import { X, Loader, ExternalLink } from 'lucide-solid';
import type { ProviderPreset } from '@openaidy/shared-types';

interface DialogConnectProviderProps {
  provider: ProviderPreset | null;
  onClose: () => void;
  onConnected?: (providerId: string, authMethod: string) => void;
}

export function DialogConnectProvider(props: DialogConnectProviderProps) {
  const [authMethod, setAuthMethod] = createSignal<'api_key' | 'oauth'>(
    'api_key',
  );
  const [apiKey, setApiKey] = createSignal('');
  const [isConnecting, setIsConnecting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // Reset state when provider changes
  createEffect(() => {
    if (props.provider) {
      setAuthMethod('api_key');
      setApiKey('');
      setError(null);
    }
  });

  const handleConnect = () => {
    const preset = props.provider;
    if (!preset) return;

    if (authMethod() === 'api_key') {
      if (!apiKey()) {
        setError('API key is required');
        return;
      }
      setIsConnecting(true);
      setError(null);
      // Simulate connection - in real app this would call the API
      setTimeout(() => {
        setIsConnecting(false);
        props.onConnected?.(preset.id, 'api_key');
        props.onClose();
      }, 500);
    } else if (authMethod() === 'oauth') {
      // Open OAuth URL in new window
      const oauthUrl = `${preset.baseUrl}/oauth/authorize?client_id=openaidy&redirect_uri=${encodeURIComponent(window.location.origin + '/auth/callback/' + preset.id)}`;
      window.open(oauthUrl, '_blank', 'width=600,height=700');
      setError('Please complete the OAuth authorization in the opened window');
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
