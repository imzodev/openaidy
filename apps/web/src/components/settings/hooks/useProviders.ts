import { createSignal } from 'solid-js';
import type { AppConfig, ProviderConfig } from '../../../lib/api';
import type { ProviderFormData } from '../types';

export function useProviders(
  config: () => AppConfig | undefined,
  updateConfigData: (config: AppConfig) => Promise<unknown>,
  showError: (text: string) => void,
) {
  const [showAddProviderModal, setShowAddProviderModal] = createSignal(false);
  const [newProviderData, setNewProviderData] = createSignal<ProviderFormData>({
    id: '',
    name: '',
    vendorFamily: 'openai-compatible',
    enabled: true,
    baseUrl: '',
    apiKeyEnv: '',
  });

  const openAddProviderModal = () => {
    setNewProviderData({
      id: '',
      name: '',
      vendorFamily: 'openai-compatible',
      enabled: true,
      baseUrl: '',
      apiKeyEnv: '',
    });
    setShowAddProviderModal(true);
  };

  const closeAddProviderModal = () => {
    setShowAddProviderModal(false);
  };

  const saveNewProvider = async () => {
    const currentConfig = config();
    if (!currentConfig) return false;

    const providerData = newProviderData();
    if (!providerData.id || !providerData.name) {
      showError('Provider ID and Name are required');
      return false;
    }

    // Build the provider object with required fields
    const newProvider: ProviderConfig = {
      id: providerData.id,
      name: providerData.name,
      vendorFamily: providerData.vendorFamily || 'openai-compatible',
      enabled: providerData.enabled ?? true,
      models: [
        {
          id: 'default-model',
          name: 'Default Model',
          enabled: true,
        },
      ],
    } as ProviderConfig;

    // Only add optional fields if they have values
    if (providerData.baseUrl) {
      (newProvider as Record<string, unknown>).baseUrl = providerData.baseUrl;
    }
    if (providerData.apiKeyEnv) {
      (newProvider as Record<string, unknown>).apiKeyEnv =
        providerData.apiKeyEnv;
    }

    const updatedConfig = {
      ...currentConfig,
      providers: [...(currentConfig.providers || []), newProvider],
    } as AppConfig;

    await updateConfigData(updatedConfig);
    setShowAddProviderModal(false);
    return true;
  };

  const deleteProvider = async (providerId: string) => {
    const currentConfig = config();
    if (!currentConfig) return;

    const updatedConfig = {
      ...currentConfig,
      providers: currentConfig.providers?.filter((p) => p.id !== providerId),
    } as AppConfig;

    await updateConfigData(updatedConfig);
  };

  const updateProvider = async (
    providerId: string,
    updatedProvider: ProviderConfig,
  ) => {
    const currentConfig = config();
    if (!currentConfig) return;

    const updatedProviders = [...(currentConfig.providers || [])];
    const providerIndex = updatedProviders.findIndex(
      (p) => p.id === providerId,
    );

    if (providerIndex !== -1) {
      updatedProviders[providerIndex] = updatedProvider;
    }

    const mergedConfig = {
      ...currentConfig,
      providers: updatedProviders,
    } as AppConfig;

    await updateConfigData(mergedConfig);
  };

  return {
    showAddProviderModal,
    newProviderData,
    setNewProviderData,
    openAddProviderModal,
    closeAddProviderModal,
    saveNewProvider,
    deleteProvider,
    updateProvider,
  };
}
