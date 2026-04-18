import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiRequestError } from '@openaidy/shared-types';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

import { updateConfig } from './api';
import type { AppConfig } from './api';

const minimalConfig: AppConfig = {
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
      models: [{ id: 'gpt-4o-mini', name: 'GPT-4o Mini', enabled: true }],
    },
  ],
  agents: [
    {
      id: 'default',
      name: 'Default',
      enabled: true,
      systemPrompt: 'You are helpful.',
      model: 'openai/gpt-4o-mini',
    },
  ],
} as unknown as AppConfig;

describe('updateConfig', () => {
  it('should return parsed response on success', async () => {
    const mockResponse = { config: minimalConfig, status: { issues: [] } };
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    const result = await updateConfig(minimalConfig);
    expect(result).toEqual(mockResponse);
  });

  it('should throw ApiRequestError on 400 with message from body.message', async () => {
    const errorBody = {
      error: 'config.invalid',
      message: 'Unknown model "gpt-5" for provider "openai"',
    };
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(errorBody), { status: 400 }),
    );

    await expect(updateConfig(minimalConfig)).rejects.toThrow(
      'Unknown model "gpt-5" for provider "openai"',
    );
  });

  it('should throw ApiRequestError instance on non-OK response', async () => {
    const errorBody = { error: 'config.invalid', message: 'Validation failed' };
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(errorBody), { status: 400 }),
    );

    await expect(updateConfig(minimalConfig)).rejects.toBeInstanceOf(
      ApiRequestError,
    );
  });

  it('should expose status and body on ApiRequestError', async () => {
    const errorBody = {
      error: 'config.invalid',
      message: 'Unknown default model "xyz" for provider "openai"',
    };
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(errorBody), { status: 422 }),
    );

    const err = await updateConfig(minimalConfig).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect((err as ApiRequestError).status).toBe(422);
    expect((err as ApiRequestError).body).toEqual(errorBody);
  });

  it('should fall back to error code when body has no message', async () => {
    const errorBody = { error: 'request.failed' };
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(errorBody), { status: 500 }),
    );

    await expect(updateConfig(minimalConfig)).rejects.toThrow('request.failed');
  });

  it('should fall back gracefully when response body is not JSON', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('Internal Server Error', { status: 500 }),
    );

    await expect(updateConfig(minimalConfig)).rejects.toBeInstanceOf(
      ApiRequestError,
    );
  });
});
