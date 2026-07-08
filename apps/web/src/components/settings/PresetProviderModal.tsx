import { createMemo, createSignal, For, Show } from 'solid-js';
import { X, Plus, Trash2, RefreshCw, Loader2 } from 'lucide-solid';
import {
  type ModelPreset,
  OPENCODE_GO_ANTHROPIC_MODEL_IDS,
} from '@openaidy/shared-types';
import { discoverProviderModels, type ProviderConfig } from '../../lib/api';
import { ModelMultiSelect } from './ModelMultiSelect';
import type { PresetProviderModalProps } from './PresetProviderModal.types';

/**
 * For OpenCode Go we present all 13 models under a single
 * "OpenCode Go" card. The 6 anthropic-format models (M3 / M2.7 /
 * M2.5 and the Qwen family) must be routed to a *different*
 * `providerId` (`opencode-go-anthropic`) so the chat adapter hits
 * `/v1/messages` instead of `/v1/chat/completions` — the gateway
 * explicitly rejects the latter for those models.
 *
 * The mapping is model-id-based, not model-name-based, so custom
 * models added by the user aren't accidentally re-routed.
 */
function resolveOpenCodeGoProviderId(
  presetId: string,
  modelId: string,
): string {
  if (
    presetId === 'opencode-go' &&
    OPENCODE_GO_ANTHROPIC_MODEL_IDS.has(modelId)
  ) {
    return 'opencode-go-anthropic';
  }
  return presetId;
}

/**
 * All preset models are checked by default. Existing custom
 * models added in a previous session keep their `enabled` flag
 * so re-opening the modal doesn't silently re-enable models the
 * user had disabled.
 */
function buildInitialSelectedIds(
  preset: ModelPreset[],
  existingProvider: ProviderConfig | undefined,
  customModels: { id: string }[],
): Set<string> {
  const existing = new Map(
    (existingProvider?.models ?? []).map((m) => [m.id, m.enabled !== false]),
  );
  const ids = new Set<string>();
  for (const m of preset) {
    ids.add(m.id);
  }
  for (const m of customModels) {
    ids.add(m.id);
  }
  // Re-apply the prior `enabled` flag where we have it.
  for (const [id, enabled] of existing) {
    if (!enabled) ids.delete(id);
  }
  return ids;
}

export function PresetProviderModal(props: PresetProviderModalProps) {
  const [customModels, setCustomModels] = createSignal<
    { id: string; name: string }[]
  >(
    props.existingProvider?.models
      ?.filter((m) => !props.preset.models.some((pm) => pm.id === m.id))
      .map((m) => ({ id: m.id, name: m.name })) || [],
  );
  const [selectedIds, setSelectedIds] = createSignal<ReadonlySet<string>>(
    buildInitialSelectedIds(
      props.preset.models,
      props.existingProvider,
      customModels(),
    ),
  );
  const [newModelId, setNewModelId] = createSignal('');
  const [newModelName, setNewModelName] = createSignal('');

  // Models discovered from a running local provider (Ollama / LM Studio).
  // Kept separate from preset/custom models so they render as normal,
  // pre-checked entries in the multi-select rather than removable "custom" rows.
  const [discoveredModels, setDiscoveredModels] = createSignal<
    { id: string; name: string }[]
  >([]);
  const [isDiscovering, setIsDiscovering] = createSignal(false);
  const [discoverError, setDiscoverError] = createSignal<string | null>(null);
  const [discoverInfo, setDiscoverInfo] = createSignal<string | null>(null);

  const allModels = createMemo<ModelPreset[]>(() => {
    const seen = new Set<string>();
    const merged: ModelPreset[] = [];
    for (const m of [
      ...props.preset.models,
      ...discoveredModels(),
      ...customModels().map((cm) => ({
        id: cm.id,
        name: cm.name,
        custom: true as const,
      })),
    ]) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      merged.push(m);
    }
    return merged;
  });

  const discoverModels = async () => {
    setIsDiscovering(true);
    setDiscoverError(null);
    setDiscoverInfo(null);
    try {
      const found = await discoverProviderModels(
        props.preset.baseUrl,
        props.existingProvider?.apiKeyEnv,
      );
      // Don't duplicate models already offered by the preset or added manually.
      const customIds = new Set(customModels().map((m) => m.id));
      const fresh = found.filter(
        (m) =>
          !props.preset.models.some((pm) => pm.id === m.id) &&
          !customIds.has(m.id),
      );
      setDiscoveredModels(fresh);
      // Pre-select everything discovered so the user can just save.
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const m of fresh) next.add(m.id);
        return next;
      });
      setDiscoverInfo(
        found.length === 0
          ? 'No models reported. Pull/load a model on the server, then retry.'
          : `Found ${found.length} model${found.length === 1 ? '' : 's'}.`,
      );
    } catch (err) {
      setDiscoverError(
        err instanceof Error ? err.message : 'Could not reach the provider.',
      );
    } finally {
      setIsDiscovering(false);
    }
  };

  const toggle = (modelId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) {
        next.delete(modelId);
      } else {
        next.add(modelId);
      }
      return next;
    });
  };

  const addCustomModel = () => {
    const id = newModelId();
    const name = newModelName();
    if (!id || !name) return;
    if (allModels().some((m) => m.id === id)) return;
    setCustomModels([...customModels(), { id, name }]);
    setSelectedIds((prev) => new Set(prev).add(id));
    setNewModelId('');
    setNewModelName('');
  };

  const removeCustomModel = (id: string) => {
    setCustomModels(customModels().filter((m) => m.id !== id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  /**
   * Build one ProviderConfig per `providerId` that has at least
   * one enabled model. Non-OpenCode-Go presets always collapse
   * to a single provider; OpenCode Go may emit two when both the
   * chat-completions and the messages-format models are enabled.
   */
  const buildProviders = (): ProviderConfig[] => {
    const enabled = allModels().filter((m) => selectedIds().has(m.id));
    if (enabled.length === 0) return [];

    const groups = new Map<string, ModelPreset[]>();
    for (const model of enabled) {
      const providerId = resolveOpenCodeGoProviderId(props.preset.id, model.id);
      const bucket = groups.get(providerId) ?? [];
      bucket.push(model);
      groups.set(providerId, bucket);
    }

    return Array.from(groups.entries()).map(([providerId, models]) => ({
      id: providerId,
      name: props.preset.name,
      vendorFamily: props.preset.vendorFamily,
      enabled: true,
      baseUrl: props.preset.baseUrl,
      apiKeyEnv: props.existingProvider?.apiKeyEnv,
      models: models.map((m) => ({
        id: m.id,
        name: m.name,
        enabled: true,
      })),
    }));
  };

  const handleSave = () => {
    const providers = buildProviders();
    if (providers.length === 0) return;
    props.onSave(providers);
  };

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center">
      <div
        class="absolute inset-0 bg-black/50"
        onClick={() => props.onClose()}
      />
      <div class="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-800">
          <h3 class="text-lg font-semibold text-text-primary">
            Configure {props.preset.name}
          </h3>
          <button
            onClick={() => props.onClose()}
            class="p-1 text-text-tertiary hover:text-text-secondary"
          >
            <X class="w-5 h-5" />
          </button>
        </div>

        <div class="p-4 space-y-4">
          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="block text-sm font-medium text-text-primary">
                Available Models
              </label>
              <Show when={props.preset.local}>
                <button
                  type="button"
                  onClick={() => void discoverModels()}
                  disabled={isDiscovering()}
                  class="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-700 text-text-secondary hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title="List models installed on the local server"
                >
                  <Show
                    when={isDiscovering()}
                    fallback={<RefreshCw class="w-3.5 h-3.5" />}
                  >
                    <Loader2 class="w-3.5 h-3.5 animate-spin" />
                  </Show>
                  {isDiscovering() ? 'Discovering…' : 'Discover models'}
                </button>
              </Show>
            </div>
            <p class="text-xs text-text-tertiary mb-2">
              <Show
                when={props.preset.local}
                fallback="Uncheck models you don't want to expose to agents."
              >
                Click "Discover models" to list what's installed on{' '}
                {props.preset.baseUrl}, or add one manually below.
              </Show>
            </p>
            <Show when={discoverError()}>
              <p class="text-xs text-red-600 dark:text-red-400 mb-2">
                {discoverError()}
              </p>
            </Show>
            <Show when={discoverInfo()}>
              <p class="text-xs text-text-tertiary mb-2">{discoverInfo()}</p>
            </Show>
            <Show
              when={allModels().length > 0}
              fallback={
                <div class="text-sm text-text-tertiary border border-dashed border-gray-200 dark:border-gray-700 rounded-lg p-4 text-center">
                  No models yet.
                </div>
              }
            >
              <ModelMultiSelect
                models={allModels()}
                selectedIds={selectedIds()}
                onToggle={toggle}
              />
            </Show>
          </div>

          <div class="pt-2 border-t border-gray-200 dark:border-gray-700">
            <label class="block text-sm font-medium text-text-primary mb-2">
              Add Custom Model
            </label>
            <div class="flex gap-2">
              <input
                type="text"
                value={newModelId()}
                onInput={(e) => setNewModelId(e.currentTarget.value)}
                placeholder="Model ID"
                class="flex-1 min-w-0 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <input
                type="text"
                value={newModelName()}
                onInput={(e) => setNewModelName(e.currentTarget.value)}
                placeholder="Display Name"
                class="flex-1 min-w-0 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <button
                onClick={addCustomModel}
                disabled={!newModelId() || !newModelName()}
                class="shrink-0 p-2 bg-primary hover:bg-primary-hover disabled:bg-primary-disabled text-white rounded-lg transition-colors"
              >
                <Plus class="w-4 h-4" />
              </button>
            </div>
          </div>

          <Show when={customModels().length > 0}>
            <div class="pt-2 border-t border-gray-200 dark:border-gray-700">
              <label class="block text-sm font-medium text-text-primary mb-2">
                Custom Models
              </label>
              <div class="space-y-2">
                <For each={customModels()}>
                  {(model) => (
                    <div class="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-700 rounded-lg">
                      <div>
                        <span class="text-sm font-medium text-text-primary">
                          {model.name}
                        </span>
                        <span class="text-xs text-text-tertiary ml-2">
                          {model.id}
                        </span>
                      </div>
                      <button
                        onClick={() => removeCustomModel(model.id)}
                        class="p-1 text-text-tertiary hover:text-red-500 transition-colors"
                      >
                        <Trash2 class="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>
        </div>

        <div class="flex items-center justify-between gap-3 p-4 border-t border-gray-200 dark:border-gray-700 sticky bottom-0 bg-white dark:bg-gray-800">
          <Show when={props.existingProvider && props.onDisconnect}>
            <button
              type="button"
              onClick={() => props.onDisconnect?.(props.preset)}
              disabled={props.isPending}
              class="px-3 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Disconnect
            </button>
          </Show>
          <div class="flex items-center gap-3 ml-auto">
            <button
              onClick={() => props.onClose()}
              class="px-4 py-2 text-sm font-medium text-text-secondary hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={props.isPending || selectedIds().size === 0}
              class="px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-primary-hover disabled:bg-primary-disabled disabled:cursor-not-allowed rounded-lg transition-colors"
            >
              {props.isPending ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
