import { Show } from 'solid-js';
import { X } from 'lucide-solid';
import type { ProviderFormData } from './types';
import type { ProviderConfig } from '../../lib/api';

interface AddProviderModalProps {
  show: () => boolean;
  onClose: () => void;
  onSave: () => void;
  data: () => ProviderFormData;
  setData: (data: ProviderFormData) => void;
  isPending: boolean;
}

export function AddProviderModal(props: AddProviderModalProps) {
  return (
    <Show when={props.show()}>
      <div class="fixed inset-0 z-50 flex items-center justify-center">
        <div
          class="absolute inset-0 bg-black/50"
          onClick={() => props.onClose()}
        />
        <div class="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
          <div class="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
            <h3 class="text-lg font-semibold text-text-primary">
              Add New Provider
            </h3>
            <button
              onClick={() => props.onClose()}
              class="p-1 text-text-tertiary hover:text-text-secondary"
            >
              <X class="w-5 h-5" />
            </button>
          </div>
          <div class="p-4 space-y-4">
            {/* Provider ID */}
            <div>
              <label class="block text-sm font-medium text-text-secondary mb-1">
                Provider ID <span class="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={props.data().id || ''}
                onInput={(e) =>
                  props.setData({
                    ...props.data(),
                    id: e.currentTarget.value,
                  })
                }
                placeholder="e.g., openai, anthropic"
                class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-text-primary focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <p class="text-xs text-text-tertiary mt-1">
                Unique identifier (lowercase letters, numbers, hyphens)
              </p>
            </div>

            {/* Display Name */}
            <div>
              <label class="block text-sm font-medium text-text-secondary mb-1">
                Display Name <span class="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={props.data().name || ''}
                onInput={(e) =>
                  props.setData({
                    ...props.data(),
                    name: e.currentTarget.value,
                  })
                }
                placeholder="e.g., OpenAI, Anthropic"
                class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-text-primary focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* Vendor Family */}
            <div>
              <label class="block text-sm font-medium text-text-secondary mb-1">
                Vendor Family
              </label>
              <select
                value={props.data().vendorFamily || 'openai-compatible'}
                onChange={(e) =>
                  props.setData({
                    ...props.data(),
                    vendorFamily: e.currentTarget
                      .value as ProviderConfig['vendorFamily'],
                  })
                }
                class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-text-primary focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="openai-compatible">OpenAI Compatible</option>
                <option value="anthropic">Anthropic</option>
                <option value="gemini">Google Gemini</option>
              </select>
            </div>

            {/* Base URL */}
            <div>
              <label class="block text-sm font-medium text-text-secondary mb-1">
                Base URL
              </label>
              <input
                type="text"
                value={props.data().baseUrl || ''}
                onInput={(e) =>
                  props.setData({
                    ...props.data(),
                    baseUrl: e.currentTarget.value,
                  })
                }
                placeholder="e.g., https://api.openai.com/v1"
                class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-text-primary focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* API Key Env */}
            <div>
              <label class="block text-sm font-medium text-text-secondary mb-1">
                API Key Environment Variable
              </label>
              <input
                type="text"
                value={props.data().apiKeyEnv || ''}
                onInput={(e) =>
                  props.setData({
                    ...props.data(),
                    apiKeyEnv: e.currentTarget.value,
                  })
                }
                placeholder="e.g., OPENAI_API_KEY"
                class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-text-primary focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <p class="text-xs text-text-tertiary mt-1">
                Name of the environment variable containing the API key
              </p>
            </div>

            {/* Enabled */}
            <div class="flex items-center gap-2">
              <input
                type="checkbox"
                id="provider-enabled"
                checked={props.data().enabled ?? true}
                onChange={(e) =>
                  props.setData({
                    ...props.data(),
                    enabled: e.currentTarget.checked,
                  })
                }
                class="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <label for="provider-enabled" class="text-sm text-text-secondary">
                Enabled
              </label>
            </div>
          </div>
          <div class="flex items-center justify-end gap-3 p-4 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={() => props.onClose()}
              class="px-4 py-2 text-sm font-medium text-text-secondary hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => props.onSave()}
              disabled={
                props.isPending || !props.data().id || !props.data().name
              }
              class="px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-primary-hover disabled:bg-primary-disabled disabled:cursor-not-allowed rounded-lg transition-colors"
            >
              {props.isPending ? 'Adding...' : 'Add Provider'}
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
