/**
 * Provider Onboarding
 *
 * Shown after login on a fresh install where no provider is configured yet.
 * It reuses the same "Ready Providers" pieces as the Settings › Providers tab
 * (PresetProviderCard grid, DialogConnectProvider, PresetProviderModal) so
 * there is a single provider-configuration UX, but frames it as a focused
 * first-run step and — crucially — sets the project default provider/model
 * once the first provider is configured, so a model-less agent immediately
 * has something to inherit.
 *
 * The parent (AppContent) decides when to show this based on whether a usable
 * default provider is configured; `onConfigured` tells it to re-check once the
 * full connect → configure → set-default flow has completed.
 */

import { createSignal, Show, For } from 'solid-js';
import { Sparkles } from 'lucide-solid';
import { PresetProviderCard } from '../settings/PresetProviderCard';
import { PresetProviderModal } from '../settings/PresetProviderModal';
import { DialogConnectProvider } from '../providers/DialogConnectProvider';
import { useConfig } from '../settings/hooks/useConfig';
import type { AppConfig, ProviderConfig } from '../../lib/api';
import type { ProviderPreset } from '@openaidy/shared-types';
import { PROVIDER_PRESETS } from '@openaidy/shared-types';

interface ProviderOnboardingProps {
  /**
   * Called after the first provider has been fully connected, configured, and
   * set as the project default. The parent re-checks connection status and,
   * once a provider is connected, dismisses this screen.
   */
  onConfigured: () => void;
}

export function ProviderOnboarding(props: ProviderOnboardingProps) {
  const { config, updateConfigData, updateMutation } = useConfig();

  const [selectedPreset, setSelectedPreset] =
    createSignal<ProviderPreset | null>(null);
  const [connectingProvider, setConnectingProvider] =
    createSignal<ProviderPreset | null>(null);

  const isConfigured = (preset: ProviderPreset) =>
    config()?.providers?.some((p) => p.id === preset.id) ?? false;

  const handleSelect = (preset: ProviderPreset) => {
    // Configured providers — and local providers, which need no API key — go
    // straight to the model-config modal. Only remote, unconfigured providers
    // open the credential dialog first.
    if (isConfigured(preset) || preset.local) {
      setSelectedPreset(preset);
    } else {
      setConnectingProvider(preset);
    }
  };

  // Pick the default model for a freshly-configured provider: the preset's
  // recommended model when it is enabled, otherwise the first enabled model.
  const pickDefaultModel = (provider: ProviderConfig): string | undefined => {
    const enabled = provider.models.filter((m) => m.enabled !== false);
    const preset = PROVIDER_PRESETS.find((p) => p.id === provider.id);
    if (preset && enabled.some((m) => m.id === preset.recommendedModel)) {
      return preset.recommendedModel;
    }
    return enabled[0]?.id;
  };

  const handleSavePreset = async (providers: ProviderConfig[]) => {
    const cfg = config();
    if (!cfg || providers.length === 0) {
      setSelectedPreset(null);
      return;
    }

    // Upsert every returned provider (OpenCode Go can return two) into the
    // config's provider list.
    const merged = [...(cfg.providers ?? [])];
    for (const provider of providers) {
      const index = merged.findIndex((p) => p.id === provider.id);
      if (index !== -1) {
        merged[index] = provider;
      } else {
        merged.push(provider);
      }
    }

    // Set the project default from the first configured provider when the
    // install has no default yet, so the model-less seeded agent becomes
    // usable immediately after onboarding. Also stamp the chosen model onto
    // any model-less agent, so the config JSON carries an explicit
    // "providerId/modelId" instead of relying on the runtime default fallback.
    let defaults = cfg.defaults;
    let agents = cfg.agents;
    if (!defaults.providerId || !defaults.modelId) {
      const primary = providers[0]!;
      const modelId = pickDefaultModel(primary);
      if (modelId) {
        const model = `${primary.id}/${modelId}`;
        defaults = { ...defaults, providerId: primary.id, modelId };
        agents = cfg.agents.map((a) => (a.model ? a : { ...a, model }));
      }
    }

    const updated = {
      ...cfg,
      providers: merged,
      defaults,
      agents,
    } as AppConfig;

    await updateConfigData(updated);
    setSelectedPreset(null);
    props.onConfigured();
  };

  return (
    <div class="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
      <div class="max-w-3xl mx-auto py-8 sm:py-12 px-4 sm:px-6">
        <div class="text-center mb-8">
          <div class="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 text-primary mb-4">
            <Sparkles class="w-6 h-6" />
          </div>
          <h1 class="text-2xl font-bold text-text-primary mb-2">
            Connect your first AI provider
          </h1>
          <p class="text-text-secondary max-w-xl mx-auto">
            OpenAidy doesn't ship with any providers configured. Pick a provider
            below and add your API key to start chatting — you can add more or
            change the default later in Settings.
          </p>
        </div>

        <div class="bg-white dark:bg-gray-800 shadow rounded-lg p-4 sm:p-6">
          <div class="flex items-center gap-2 mb-3">
            <Sparkles class="w-4 h-4 text-primary" />
            <h2 class="text-sm font-medium text-text-primary">
              Ready Providers
            </h2>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <For each={PROVIDER_PRESETS as ProviderPreset[]}>
              {(preset) => (
                <PresetProviderCard
                  preset={preset}
                  isConfigured={isConfigured(preset)}
                  onSelect={handleSelect}
                />
              )}
            </For>
          </div>
        </div>
      </div>

      {/* Configure-models modal (opened after connecting, or directly for
          local providers / already-configured ones). */}
      <Show when={selectedPreset()}>
        <PresetProviderModal
          preset={selectedPreset()!}
          existingProvider={
            config()?.providers?.find((p) => p.id === selectedPreset()!.id) as
              | ProviderConfig
              | undefined
          }
          onClose={() => setSelectedPreset(null)}
          onSave={handleSavePreset}
          isPending={updateMutation.isPending}
        />
      </Show>

      {/* Credential dialog for remote, unconfigured providers. */}
      <DialogConnectProvider
        provider={connectingProvider()}
        onClose={() => setConnectingProvider(null)}
        onConnected={(providerId) => {
          setConnectingProvider(null);
          const preset = PROVIDER_PRESETS.find((p) => p.id === providerId);
          if (preset) {
            setSelectedPreset(preset);
          }
        }}
      />
    </div>
  );
}
