import { createSignal, onMount } from 'solid-js';
import {
  createQuery,
  createMutation,
  useQueryClient,
} from '@tanstack/solid-query';
import { getConfig, updateConfig, type AppConfig } from '../../../lib/api';
import type { SaveMessage, ConfigResponse } from '../types';

const SAVE_MESSAGE_TIMEOUT_MS = 3000;

export function useConfig() {
  const queryClient = useQueryClient();
  const [rawJson, setRawJson] = createSignal('');
  const [saveMessage, setSaveMessageSignal] = createSignal<SaveMessage>(null);
  let saveMessageTimeout: ReturnType<typeof setTimeout> | undefined;

  // Wrapper that cancels any pending auto-dismiss timer. Callers
  // that want to override the message while one is still on screen
  // (e.g. a custom disconnect success toast) get the full 3s.
  const setSaveMessage = (msg: SaveMessage) => {
    if (saveMessageTimeout) {
      clearTimeout(saveMessageTimeout);
      saveMessageTimeout = undefined;
    }
    setSaveMessageSignal(msg);
    if (msg) {
      saveMessageTimeout = setTimeout(() => {
        setSaveMessageSignal(null);
        saveMessageTimeout = undefined;
      }, SAVE_MESSAGE_TIMEOUT_MS);
    }
  };

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
