import { createSignal, onMount } from 'solid-js';
import {
  createQuery,
  createMutation,
  useQueryClient,
} from '@tanstack/solid-query';
import {
  getConfig,
  updateConfig,
  type AppConfig,
  type ConfigStatus,
} from '../../../lib/api';
import type { SaveMessage } from '../types';

type ConfigResponse =
  | { config: AppConfig; status: ConfigStatus }
  | { error: string };

export function useConfig() {
  const queryClient = useQueryClient();
  const [rawJson, setRawJson] = createSignal('');
  const [saveMessage, setSaveMessage] = createSignal<SaveMessage>(null);

  const configQuery = createQuery(() => ({
    queryKey: ['config'],
    queryFn: getConfig,
  }));

  onMount(() => {
    const data = configQuery.data as ConfigResponse | undefined;
    if (data && 'config' in data && data.config) {
      setRawJson(JSON.stringify(data.config, null, 2));
    }
  });

  const config = () => {
    const data = configQuery.data as ConfigResponse | undefined;
    return data && 'config' in data ? data.config : undefined;
  };

  const updateMutation = createMutation(() => ({
    mutationFn: (newConfig: AppConfig) => updateConfig(newConfig),
    onSuccess: (data: ConfigResponse) => {
      queryClient.invalidateQueries({ queryKey: ['config'] });
      if (data && 'config' in data && data.config) {
        setRawJson(JSON.stringify(data.config, null, 2));
      }
      setSaveMessage({
        type: 'success',
        text: 'Configuration saved successfully',
      });
      setTimeout(() => setSaveMessage(null), 3000);
    },
    onError: (error: Error) => {
      setSaveMessage({
        type: 'error',
        text: `Failed to save: ${error.message}`,
      });
    },
  }));

  const updateConfigData = (newConfig: AppConfig) => {
    return updateMutation.mutateAsync(newConfig);
  };

  const showSaveError = (text: string) => {
    setSaveMessage({ type: 'error', text });
  };

  return {
    configQuery,
    config,
    updateMutation,
    updateConfigData,
    rawJson,
    setRawJson,
    saveMessage,
    setSaveMessage,
    showSaveError,
  };
}
