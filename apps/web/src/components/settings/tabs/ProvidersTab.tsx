import { Show, For, createMemo } from 'solid-js';
import { Plus } from 'lucide-solid';
import {
  DynamicConfigForm,
  getProvidersSectionSchema,
  type FormSchema,
} from '../../../config';
import { CollapsibleCard } from '../../ui';
import type { AppConfig, ProviderConfig } from '../../../lib/api';

interface ProvidersTabProps {
  config: () => AppConfig | undefined;
  isPending: boolean;
  onAddProvider: () => void;
  onDeleteProvider: (providerId: string) => void;
  onUpdateProvider: (providerId: string, provider: ProviderConfig) => void;
}

export function ProvidersTab(props: ProvidersTabProps) {
  const providersSchema = createMemo((): FormSchema => {
    return {
      sections: [getProvidersSectionSchema()],
    };
  });

  const handleProviderChange = (
    providerId: string,
    newConfig: Record<string, unknown>,
  ) => {
    const currentConfig = props.config();
    if (!currentConfig || !Array.isArray(newConfig.providers)) return;

    const updatedProvider = newConfig.providers[0] as ProviderConfig;
    props.onUpdateProvider(providerId, updatedProvider);
  };

  return (
    <div class="p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Providers
        </h2>
        <button
          onClick={() => props.onAddProvider()}
          disabled={props.isPending}
          class="flex items-center gap-2 px-3 py-1.5 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-400 text-white rounded-lg transition-colors text-sm font-medium"
        >
          <Plus class="w-4 h-4" />
          Add Provider
        </button>
      </div>

      <Show
        when={(props.config()?.providers?.length ?? 0) > 0}
        fallback={
          <div class="text-center py-8 text-gray-500 dark:text-gray-400">
            <p>No providers configured.</p>
            <p class="text-sm mt-2">
              Click "Add Provider" to add a new provider.
            </p>
          </div>
        }
      >
        <For each={props.config()?.providers}>
          {(provider, index) => (
            <CollapsibleCard
              title={provider.name}
              index={index()}
              badge={provider.vendorFamily}
              badgeVariant="info"
              onDelete={() => props.onDeleteProvider(provider.id)}
              isPending={props.isPending}
            >
              <DynamicConfigForm
                config={{ providers: [provider] } as Record<string, unknown>}
                schema={providersSchema()}
                onChange={(newConfig) =>
                  handleProviderChange(provider.id, newConfig)
                }
                errors={{}}
              />
            </CollapsibleCard>
          )}
        </For>
      </Show>
    </div>
  );
}
