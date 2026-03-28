import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent, cleanup } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { DefaultsTab } from './DefaultsTab';
import type { AppConfig } from '../../../lib/api';

const baseConfig: AppConfig = {
  version: 1,
  defaults: {
    providerId: 'openai',
    modelId: 'gpt-4o-mini',
    agentId: 'default',
  },
  providers: [
    {
      id: 'openai',
      name: 'OpenAI',
      vendorFamily: 'openai-compatible',
      enabled: true,
      models: [],
    },
    {
      id: 'anthropic',
      name: 'Anthropic',
      vendorFamily: 'anthropic',
      enabled: true,
      models: [],
    },
  ],
  agents: [
    {
      id: 'default',
      name: 'Default Assistant',
      enabled: true,
      description: 'Default agent',
      systemPrompt: 'You are helpful.',
      model: 'openai/gpt-4o-mini',
    },
    {
      id: 'research',
      name: 'Research Agent',
      enabled: true,
      description: 'Research specialist',
      systemPrompt: 'You research things.',
      model: 'anthropic/claude-3-5-sonnet',
    },
  ],
};

describe('DefaultsTab', () => {
  beforeEach(() => {
    cleanup();
  });

  const mergeDefaultsChange = (
    setConfig: (updater: (prev: AppConfig) => AppConfig) => void,
  ) => {
    return (newConfig: Record<string, unknown>) => {
      setConfig((prev) => ({
        ...prev,
        defaults: {
          ...prev.defaults,
          ...((newConfig.defaults as Record<string, unknown> | undefined) ??
            {}),
        },
      }));
    };
  };

  it('preserves unsaved text input when default provider changes', async () => {
    const [config, setConfig] = createSignal<AppConfig>(
      structuredClone(baseConfig),
    );

    const handleChange = mergeDefaultsChange(setConfig);

    render(() => <DefaultsTab config={config} onChange={handleChange} />);

    const textboxes = document.querySelectorAll('input[type="text"]');
    const selects = document.querySelectorAll('select');
    const modelInput = textboxes[0] as HTMLInputElement;
    const providerSelect = selects[0] as HTMLSelectElement;

    fireEvent.input(modelInput, {
      currentTarget: { value: 'draft-model-value' },
      target: { value: 'draft-model-value' },
    });

    expect(modelInput.value).toBe('draft-model-value');

    fireEvent.change(providerSelect, {
      currentTarget: { value: 'anthropic' },
      target: { value: 'anthropic' },
    });

    expect(providerSelect.value).toBe('anthropic');
    expect(modelInput.value).toBe('draft-model-value');
  });

  it('preserves unsaved text input when default agent changes', async () => {
    const [config, setConfig] = createSignal<AppConfig>(
      structuredClone(baseConfig),
    );

    const handleChange = mergeDefaultsChange(setConfig);

    render(() => <DefaultsTab config={config} onChange={handleChange} />);

    const textboxes = document.querySelectorAll('input[type="text"]');
    const selects = document.querySelectorAll('select');
    const modelInput = textboxes[0] as HTMLInputElement;
    const agentSelect = selects[1] as HTMLSelectElement;

    fireEvent.input(modelInput, {
      currentTarget: { value: 'draft-before-agent-change' },
      target: { value: 'draft-before-agent-change' },
    });

    expect(modelInput.value).toBe('draft-before-agent-change');

    fireEvent.change(agentSelect, {
      currentTarget: { value: 'research' },
      target: { value: 'research' },
    });

    expect(agentSelect.value).toBe('research');
    expect(modelInput.value).toBe('draft-before-agent-change');
  });

  it('preserves previously selected defaults when another defaults field changes', async () => {
    const [config, setConfig] = createSignal<AppConfig>(
      structuredClone(baseConfig),
    );

    const handleChange = mergeDefaultsChange(setConfig);

    render(() => <DefaultsTab config={config} onChange={handleChange} />);

    const selects = document.querySelectorAll('select');
    const providerSelect = selects[0] as HTMLSelectElement;
    const agentSelect = selects[1] as HTMLSelectElement;

    fireEvent.change(providerSelect, {
      currentTarget: { value: 'anthropic' },
      target: { value: 'anthropic' },
    });

    expect(providerSelect.value).toBe('anthropic');
    expect(config().defaults.providerId).toBe('anthropic');
    expect(config().defaults.agentId).toBe('default');

    fireEvent.change(agentSelect, {
      currentTarget: { value: 'research' },
      target: { value: 'research' },
    });

    expect(agentSelect.value).toBe('research');
    expect(config().defaults.providerId).toBe('anthropic');
    expect(config().defaults.agentId).toBe('research');
  });
});
