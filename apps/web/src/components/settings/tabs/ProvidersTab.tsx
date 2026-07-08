import { createSignal, Show, For } from 'solid-js';
import { Settings2, Sparkles, X } from 'lucide-solid';
import { PresetProviderCard } from '../PresetProviderCard';
import { PresetProviderModal } from '../PresetProviderModal';
import { DialogConnectProvider } from '../../providers/DialogConnectProvider';
import {
  DynamicConfigForm,
  getProvidersSectionSchemaWithModels,
} from '../../../config';
import { CollapsibleCard, ConfirmDialog } from '../../ui';
import {
  disconnectProvider,
  type AppConfig,
  type ProviderConfig,
  type RewiredAgentNotice,
} from '../../../lib/api';
import type { ProviderPreset, ProviderPresetId } from '@openaidy/shared-types';
import { PROVIDER_PRESETS } from '@openaidy/shared-types';

const READY_PROVIDER_IDS = new Set(PROVIDER_PRESETS.map((p) => p.id));

interface ProvidersTabProps {
  config: () => AppConfig | undefined;
  isPending: boolean;
  onAddProvider: (provider: ProviderConfig) => void;
  onDeleteProvider: (providerId: string) => void;
  onUpdateProvider: (providerId: string, provider: ProviderConfig) => void;
  /**
   * Persist an arbitrary `AppConfig`. Used by the disconnect flow,
   * which has to rewire affected agents in the same write so the
   * server-side config schema (which rejects an agent that points
   * at a non-existent provider) accepts the change.
   */
  onSaveConfig: (newConfig: AppConfig) => Promise<unknown>;
  /**
   * Called after a successful disconnect with one notice per
   * agent that was auto-rewired to the project default model.
   * The parent (SettingsView) surfaces these as per-agent banners
   * in the Agents tab so the user can see *why* the model value
   * changed.
   */
  onAgentsRewired: (notices: RewiredAgentNotice[]) => void;
}

export function ProvidersTab(props: ProvidersTabProps) {
  const [selectedPreset, setSelectedPreset] =
    createSignal<ProviderPreset | null>(null);
  const [showCustomModal, setShowCustomModal] = createSignal(false);
  const [connectingProvider, setConnectingProvider] =
    createSignal<ProviderPreset | null>(null);
  // When set, the ConfirmDialog is shown. The card icon and the
  // modal footer link both flow into this single state.
  const [disconnectTarget, setDisconnectTarget] =
    createSignal<ProviderPreset | null>(null);
  const [isDisconnecting, setIsDisconnecting] = createSignal(false);
  const [disconnectError, setDisconnectError] = createSignal<string | null>(
    null,
  );

  const getCustomProviders = (): ProviderConfig[] => {
    return (
      props
        .config()
        ?.providers?.filter(
          (p) => !READY_PROVIDER_IDS.has(p.id as ProviderPresetId),
        ) ?? []
    );
  };

  const hasCustomProviders = () => getCustomProviders().length > 0;

  const handleSavePreset = (providers: ProviderConfig[]) => {
    for (const provider of providers) {
      const existing = props
        .config()
        ?.providers?.find((p) => p.id === provider.id);
      if (existing) {
        props.onUpdateProvider(provider.id, provider);
      } else {
        props.onAddProvider(provider);
      }
    }
    setSelectedPreset(null);
  };

  // Request to disconnect — opens the confirmation dialog. Wired
  // from both the inline card icon and the "Disconnect" link in
  // the management modal's footer so there's one chokepoint.
  const requestDisconnect = (preset: ProviderPreset) => {
    setDisconnectError(null);
    setDisconnectTarget(preset);
    // Close the management modal if it's open, so the user isn't
    // looking at a stale "configured" state behind the confirm.
    setSelectedPreset(null);
  };

  // ── Disconnect impact analysis ─────────────────────────────────
  //
  // Removing a provider breaks every agent whose `model` field
  // references it ("<providerId>/<modelId>"). The server-side
  // config schema rejects such a state, so we have to rewire the
  // affected agents in the same write that removes the provider.
  // We also need to flag the cases where the user can't disconnect
  // at all: when the target is the project default provider, or
  // when it would leave the config with zero enabled providers.

  type DisconnectImpact = {
    /** Agents that need to be re-pointed at the project default. */
    affectedAgents: { id: string; name: string }[];
    /** True when this provider is the project default. */
    isDefaultProvider: boolean;
    /** True when removing this provider would leave no enabled providers. */
    isLastEnabledProvider: boolean;
  };

  const computeDisconnectImpact = (targetId: string): DisconnectImpact => {
    const cfg = props.config();
    const affectedAgents =
      cfg?.agents
        .filter((a) => a.model.split('/')[0] === targetId)
        .map((a) => ({ id: a.id, name: a.name })) ?? [];
    const isDefaultProvider = cfg?.defaults.providerId === targetId;
    const isLastEnabledProvider =
      cfg?.providers.filter((p) => p.id !== targetId && p.enabled).length === 0;
    return { affectedAgents, isDefaultProvider, isLastEnabledProvider };
  };

  // Build a new AppConfig with the target provider removed and all
  // affected agents re-pointed at the project default. Returns
  // `null` when the impact analysis says the user must change the
  // default provider first (in which case `canDisconnect` is the
  // source of truth for the UI).
  const buildRewiredConfig = (targetId: string): AppConfig | null => {
    const cfg = props.config();
    if (!cfg) return null;
    const impact = computeDisconnectImpact(targetId);
    if (impact.isDefaultProvider || impact.isLastEnabledProvider) {
      return null;
    }
    const fallbackModel = `${cfg.defaults.providerId}/${cfg.defaults.modelId}`;
    return {
      ...cfg,
      providers: cfg.providers.filter((p) => p.id !== targetId),
      agents: cfg.agents.map((a) =>
        a.model.split('/')[0] === targetId ? { ...a, model: fallbackModel } : a,
      ),
    } as AppConfig;
  };

  // Can the user disconnect this provider at all? Drives the
  // confirm button's disabled state.
  const canDisconnect = (targetId: string): boolean => {
    const impact = computeDisconnectImpact(targetId);
    return !impact.isDefaultProvider && !impact.isLastEnabledProvider;
  };

  // Confirmed disconnect — order matters:
  //   1. Persist the rewired config (with provider removed and
  //      affected agents re-pointed at the project default) so the
  //      server-side schema accepts the write.
  //   2. Clear the encrypted credential server-side. The OpenAI-
  //      compatible adapter's in-memory cache is invalidated by the
  //      repository's `onChange` hook on the credential write.
  //   3. Emit one RewiredAgentNotice per affected agent so the
  //      Agents tab can flag the change for the user.
  const confirmDisconnect = async () => {
    const target = disconnectTarget();
    if (!target) return;
    if (!canDisconnect(target.id)) {
      setDisconnectError(
        'Set another provider as the project default before disconnecting this one.',
      );
      return;
    }
    const cfg = props.config();
    const rewired = buildRewiredConfig(target.id);
    if (!rewired || !cfg) return;

    // Snapshot the pre-rewire model per agent before the new
    // config is persisted, so the notice can say "this used to be
    // X, now it's Y" instead of just "the model changed".
    const fallbackModel = `${cfg.defaults.providerId}/${cfg.defaults.modelId}`;
    const rewiredAgents = cfg.agents.filter(
      (a) => a.model.split('/')[0] === target.id,
    );
    const notices: RewiredAgentNotice[] = rewiredAgents.map((a) => ({
      agentId: a.id,
      fromProviderId: target.id,
      fromModel: a.model,
      toModel: fallbackModel,
      rewiredAt: new Date().toISOString(),
    }));

    setIsDisconnecting(true);
    setDisconnectError(null);
    try {
      await props.onSaveConfig(rewired);
      await disconnectProvider(target.id);
      props.onAgentsRewired(notices);
      setDisconnectTarget(null);
    } catch (err) {
      setDisconnectError(
        err instanceof Error ? err.message : 'Failed to disconnect',
      );
    } finally {
      setIsDisconnecting(false);
    }
  };

  return (
    <div class="p-4 sm:p-6 space-y-5 sm:space-y-6">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
        <div>
          <h2 class="text-lg font-semibold text-text-primary">Providers</h2>
          <p class="text-sm text-text-tertiary mt-0.5">
            Configure AI providers for your agents
          </p>
        </div>
        <button
          onClick={() => setShowCustomModal(true)}
          disabled={props.isPending}
          class="flex items-center justify-center gap-2 px-3 py-1.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-text-primary rounded-lg transition-colors text-sm font-medium shrink-0"
        >
          <Settings2 class="w-4 h-4" />
          Add Custom
        </button>
      </div>

      {/* Ready Providers Grid */}
      <div>
        <div class="flex items-center gap-2 mb-3">
          <Sparkles class="w-4 h-4 text-primary" />
          <h3 class="text-sm font-medium text-text-primary">Ready Providers</h3>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-2 gap-2">
          <For each={PROVIDER_PRESETS as ProviderPreset[]}>
            {(preset) => {
              const isConfigured = () =>
                props.config()?.providers?.some((p) => p.id === preset.id) ??
                false;
              const isThisDisconnecting = () =>
                isDisconnecting() && disconnectTarget()?.id === preset.id;
              const handleSelect = () => {
                if (isConfigured() || preset.local) {
                  // Configured providers — and local providers, which need no
                  // API key — go straight to the model-config modal. Only
                  // remote, unconfigured providers open the credential dialog.
                  setSelectedPreset(preset);
                } else {
                  // If not configured, show connection dialog
                  setConnectingProvider(preset);
                }
              };
              return (
                <PresetProviderCard
                  preset={preset}
                  isConfigured={isConfigured()}
                  onSelect={handleSelect}
                  onDisconnect={requestDisconnect}
                  isDisconnectPending={isThisDisconnecting()}
                />
              );
            }}
          </For>
        </div>
      </div>

      {/* Custom Providers Section */}
      <Show when={hasCustomProviders()}>
        <div>
          <h3 class="text-sm font-medium text-text-primary mb-3 flex items-center gap-2">
            <Settings2 class="w-4 h-4 text-text-tertiary" />
            Custom Providers
          </h3>
          <div class="space-y-3">
            <For each={getCustomProviders()}>
              {(provider, index) => (
                <CollapsibleCard
                  title={provider.name}
                  index={index()}
                  badge={provider.vendorFamily}
                  badgeVariant="info"
                  showEnabled
                  enabled={provider.enabled}
                  onDelete={() => props.onDeleteProvider(provider.id)}
                  isPending={props.isPending}
                >
                  <DynamicConfigForm
                    config={
                      { providers: [provider] } as Record<string, unknown>
                    }
                    schema={{
                      sections: [getProvidersSectionSchemaWithModels(provider)],
                    }}
                    onChange={(newConfig) =>
                      props.onUpdateProvider(
                        provider.id,
                        (newConfig as { providers: ProviderConfig[] })
                          .providers[0],
                      )
                    }
                    errors={{}}
                  />
                </CollapsibleCard>
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* Empty State */}
      <Show when={!hasCustomProviders()}>
        <div class="text-center py-8 text-text-tertiary">
          <p>No providers configured yet.</p>
          <p class="text-sm mt-2">
            Add a Ready Provider above or create a custom one.
          </p>
        </div>
      </Show>

      {/* Preset Modal */}
      <Show when={selectedPreset()}>
        <PresetProviderModal
          preset={selectedPreset()!}
          existingProvider={
            props
              .config()
              ?.providers?.find((p) => p.id === selectedPreset()!.id) as
              | ProviderConfig
              | undefined
          }
          onClose={() => setSelectedPreset(null)}
          onSave={handleSavePreset}
          onDisconnect={requestDisconnect}
          isPending={props.isPending}
        />
      </Show>

      {/* Disconnect confirmation — single chokepoint for both the
          card icon and the modal footer link. */}
      <ConfirmDialog
        isOpen={disconnectTarget() !== null}
        title={
          disconnectTarget()
            ? `Disconnect from ${disconnectTarget()!.name}?`
            : ''
        }
        tone="danger"
        confirmLabel="Disconnect"
        isPending={isDisconnecting()}
        confirmDisabled={
          !!disconnectTarget() && !canDisconnect(disconnectTarget()!.id)
        }
        onConfirm={confirmDisconnect}
        onCancel={() => {
          if (!isDisconnecting()) setDisconnectTarget(null);
        }}
        body={
          <Show when={disconnectTarget()} keyed>
            {(target) => {
              const impact = computeDisconnectImpact(target.id);
              return (
                <div class="space-y-2">
                  <p>
                    This will sign you out of {target.name} and remove the
                    provider from your configuration.
                  </p>
                  <Show when={impact.affectedAgents.length > 0}>
                    <div class="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-2 text-xs text-amber-800 dark:text-amber-200">
                      <p class="font-medium">
                        {impact.affectedAgents.length === 1
                          ? '1 agent uses this provider'
                          : `${impact.affectedAgents.length} agents use this provider`}
                        :
                      </p>
                      <ul class="mt-1 list-disc list-inside">
                        <For each={impact.affectedAgents}>
                          {(a) => <li>{a.name}</li>}
                        </For>
                      </ul>
                      <p class="mt-1">
                        They will be re-pointed at the project default model (
                        <code class="font-mono">
                          {props.config()?.defaults.providerId}/
                          {props.config()?.defaults.modelId}
                        </code>
                        ).
                      </p>
                    </div>
                  </Show>
                  <Show when={impact.isDefaultProvider}>
                    <div class="rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-2 text-xs text-red-700 dark:text-red-300">
                      This provider is your project default. Set another
                      provider as default in the Configuration defaults before
                      disconnecting.
                    </div>
                  </Show>
                  <Show when={impact.isLastEnabledProvider}>
                    <div class="rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-2 text-xs text-red-700 dark:text-red-300">
                      This is the only enabled provider. Enable another provider
                      first or the configuration would be left with no usable
                      model.
                    </div>
                  </Show>
                  <Show when={disconnectError()}>
                    <p class="text-red-600 dark:text-red-400 text-xs">
                      {disconnectError()}
                    </p>
                  </Show>
                  <p class="text-xs text-text-tertiary">
                    You can reconnect at any time.
                  </p>
                </div>
              );
            }}
          </Show>
        }
      />

      {/* Custom Provider Modal */}
      <Show when={showCustomModal()}>
        <CustomProviderModal
          onClose={() => setShowCustomModal(false)}
          onSave={(provider) => {
            props.onAddProvider(provider);
            setShowCustomModal(false);
          }}
          isPending={props.isPending}
        />
      </Show>

      {/* Connect Provider Dialog */}
      <DialogConnectProvider
        provider={connectingProvider()}
        onClose={() => setConnectingProvider(null)}
        onConnected={(providerId, _authMethod) => {
          setConnectingProvider(null);
          // Find the preset and open the preset modal to configure
          const preset = PROVIDER_PRESETS.find((p) => p.id === providerId);
          if (preset) {
            setSelectedPreset(preset);
          }
        }}
      />
    </div>
  );
}

interface CustomProviderModalProps {
  onClose: () => void;
  onSave: (provider: ProviderConfig) => void;
  isPending: boolean;
}

function CustomProviderModal(props: CustomProviderModalProps) {
  const [id, setId] = createSignal('');
  const [name, setName] = createSignal('');
  const [vendorFamily, setVendorFamily] = createSignal<
    'openai-compatible' | 'anthropic' | 'gemini'
  >('openai-compatible');
  const [baseUrl, setBaseUrl] = createSignal('');
  const [apiKeyEnv, setApiKeyEnv] = createSignal('');

  const handleSave = () => {
    if (!id() || !name()) return;

    const provider: ProviderConfig = {
      id: id(),
      name: name(),
      vendorFamily: vendorFamily(),
      enabled: true,
      baseUrl: baseUrl() || undefined,
      apiKeyEnv: apiKeyEnv() || undefined,
      models: [],
    };

    props.onSave(provider);
  };

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center">
      <div
        class="absolute inset-0 bg-black/50"
        onClick={() => props.onClose()}
      />
      <div class="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4">
        <div class="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h3 class="text-lg font-semibold text-text-primary">
            Add Custom Provider
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
            <label class="block text-sm font-medium text-text-primary mb-1">
              Provider ID <span class="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={id()}
              onInput={(e) => setId(e.currentTarget.value)}
              placeholder="e.g., custom-ai"
              class="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-text-primary mb-1">
              Display Name <span class="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              placeholder="e.g., Custom AI"
              class="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-text-primary mb-1">
              Vendor Family
            </label>
            <select
              value={vendorFamily()}
              onChange={(e) =>
                setVendorFamily(
                  e.currentTarget.value as
                    | 'openai-compatible'
                    | 'anthropic'
                    | 'gemini',
                )
              }
              class="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="openai-compatible">OpenAI Compatible</option>
              <option value="anthropic">Anthropic</option>
              <option value="gemini">Google Gemini</option>
            </select>
          </div>

          <div>
            <label class="block text-sm font-medium text-text-primary mb-1">
              Base URL
            </label>
            <input
              type="text"
              value={baseUrl()}
              onInput={(e) => setBaseUrl(e.currentTarget.value)}
              placeholder="e.g., https://api.custom.ai/v1"
              class="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-text-primary mb-1">
              API Key Env Variable
            </label>
            <input
              type="text"
              value={apiKeyEnv()}
              onInput={(e) => setApiKeyEnv(e.currentTarget.value)}
              placeholder="e.g., CUSTOM_AI_API_KEY"
              class="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
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
            onClick={handleSave}
            disabled={props.isPending || !id() || !name()}
            class="px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-primary-hover disabled:bg-primary-disabled disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            {props.isPending ? 'Adding...' : 'Add Provider'}
          </button>
        </div>
      </div>
    </div>
  );
}
