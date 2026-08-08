import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent, cleanup } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { ExecutionTab } from './ExecutionTab';
import type { AppConfig } from '../../../lib/api';

const baseConfig: AppConfig = {
  version: 1,
  defaults: {
    providerId: 'openai',
    modelId: 'gpt-4o-mini',
    agentId: 'default',
  },
  providers: [],
  agents: [
    {
      id: 'default',
      name: 'Default Assistant',
      enabled: true,
      description: 'Default agent',
      systemPrompt: 'You are helpful.',
      model: 'openai/gpt-4o-mini',
    },
  ],
  execution: {
    maxRetries: 5,
    depContextPerItemChars: 2000,
    depContextTotalChars: 8000,
  },
};

describe('ExecutionTab', () => {
  beforeEach(() => {
    cleanup();
  });

  const mergeExecutionChange = (
    setConfig: (updater: (prev: AppConfig) => AppConfig) => void,
  ) => {
    return (newConfig: Record<string, unknown>) => {
      setConfig((prev) => ({
        ...prev,
        execution: {
          ...prev.execution,
          ...((newConfig.execution as Record<string, unknown> | undefined) ??
            {}),
        } as AppConfig['execution'],
      }));
    };
  };

  it('renders current retry/context limits from config', () => {
    const [config] = createSignal<AppConfig>(structuredClone(baseConfig));

    render(() => <ExecutionTab config={config} onChange={() => {}} />);

    const numberInputs = document.querySelectorAll('input[type="number"]');
    expect(numberInputs).toHaveLength(3);
    expect((numberInputs[0] as HTMLInputElement).value).toBe('5');
    expect((numberInputs[1] as HTMLInputElement).value).toBe('2000');
    expect((numberInputs[2] as HTMLInputElement).value).toBe('8000');
  });

  it('propagates an edited max retries value on blur', () => {
    const [config, setConfig] = createSignal<AppConfig>(
      structuredClone(baseConfig),
    );
    const handleChange = mergeExecutionChange(setConfig);

    render(() => <ExecutionTab config={config} onChange={handleChange} />);

    const maxRetriesInput = document.querySelectorAll(
      'input[type="number"]',
    )[0] as HTMLInputElement;

    fireEvent.input(maxRetriesInput, {
      currentTarget: { value: '10' },
      target: { value: '10' },
    });
    fireEvent.blur(maxRetriesInput);

    expect(config().execution?.maxRetries).toBe(10);
    expect(config().execution?.depContextPerItemChars).toBe(2000);
  });
});
