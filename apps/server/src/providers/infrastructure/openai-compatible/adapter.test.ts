/**
 * Tests for OpenAI-Compatible Provider Adapter
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createOpenAICompatibleProvider,
  createOpenAIProvider,
  createCompatibleProvider,
} from './adapter';
import type { ModelRequest } from '@openaidy/runtime';

// Mock the app logger so we can assert log calls without hitting the real buffer
const mockLoggerInstance = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};
vi.mock('../../../lib/logger', () => ({
  createLogger: vi.fn(() => mockLoggerInstance),
}));

// Mock the OpenAI SDK - the factory function is hoisted, so everything must be self-contained
vi.mock('openai', () => {
  // Create shared mock functions that will be reused across all instances
  const sharedMocks = {
    listModels: vi.fn(),
    retrieveModel: vi.fn(),
    createCompletion: vi.fn(),
  };

  // Create a mock APIError class inside the factory
  const MockAPIError = class APIError extends Error {
    code: string;
    type: string;
    status?: number;
    headers?: { get: (key: string) => string | null };

    constructor(
      message: string,
      code: string = 'unknown',
      type: string = 'api_error',
    ) {
      super(message);
      this.name = 'APIError';
      this.code = code;
      this.type = type;
    }
  };

  const MockOpenAI = vi.fn().mockImplementation(() => ({
    models: {
      list: sharedMocks.listModels,
      retrieve: sharedMocks.retrieveModel,
    },
    chat: {
      completions: {
        create: sharedMocks.createCompletion,
      },
    },
  }));

  // Attach APIError to the mock constructor (like the real OpenAI SDK)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (MockOpenAI as any).APIError = MockAPIError;

  // Also expose the shared mocks for direct access
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (MockOpenAI as any).__sharedMocks__ = sharedMocks;

  return {
    default: MockOpenAI,
    OpenAI: MockOpenAI,
    APIError: MockAPIError,
  };
});

// Get references to the shared mock functions
async function getMockFunctions() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const OpenAI = (await import('openai')).default as any;
  return {
    mockListModels: OpenAI.__sharedMocks__.listModels as ReturnType<
      typeof vi.fn
    >,
    mockRetrieveModel: OpenAI.__sharedMocks__.retrieveModel as ReturnType<
      typeof vi.fn
    >,
    mockCreateCompletion: OpenAI.__sharedMocks__.createCompletion as ReturnType<
      typeof vi.fn
    >,
  };
}

describe('OpenAICompatibleProvider', () => {
  let mockListModels: ReturnType<typeof vi.fn>;
  let mockRetrieveModel: ReturnType<typeof vi.fn>;
  let mockCreateCompletion: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mocks = await getMockFunctions();
    mockListModels = mocks.mockListModels;
    mockRetrieveModel = mocks.mockRetrieveModel;
    mockCreateCompletion = mocks.mockCreateCompletion;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('descriptor', () => {
    it('should have correct descriptor with defaults', () => {
      const provider = createOpenAICompatibleProvider({
        apiKey: 'test-key',
      });

      expect(provider.descriptor.id).toBe('openai-compatible');
      expect(provider.descriptor.name).toBe('OpenAI-Compatible');
      expect(provider.descriptor.vendorFamily).toBe('openai-compatible');
      expect(provider.descriptor.capabilities).toContain('text_generation');
      expect(provider.descriptor.capabilities).toContain('streaming');
      expect(provider.descriptor.capabilities).toContain('tool_calls');
    });

    it('should allow custom provider id and name', () => {
      const provider = createOpenAICompatibleProvider({
        apiKey: 'test-key',
        providerId: 'custom-provider',
        providerName: 'Custom Provider',
      });

      expect(provider.descriptor.id).toBe('custom-provider');
      expect(provider.descriptor.name).toBe('Custom Provider');
    });

    it('should disable streaming capability when configured', () => {
      const provider = createOpenAICompatibleProvider({
        apiKey: 'test-key',
        enableStreaming: false,
      });

      expect(provider.descriptor.capabilities).not.toContain('streaming');
    });

    it('should disable tool_calls capability when configured', () => {
      const provider = createOpenAICompatibleProvider({
        apiKey: 'test-key',
        enableTools: false,
      });

      expect(provider.descriptor.capabilities).not.toContain('tool_calls');
    });
  });

  describe('hasCapability', () => {
    it('should return true for supported capabilities', () => {
      const provider = createOpenAICompatibleProvider({ apiKey: 'test-key' });

      expect(provider.hasCapability('text_generation')).toBe(true);
      expect(provider.hasCapability('streaming')).toBe(true);
      expect(provider.hasCapability('tool_calls')).toBe(true);
    });

    it('should return false for unsupported capabilities', () => {
      const provider = createOpenAICompatibleProvider({ apiKey: 'test-key' });

      expect(provider.hasCapability('vision')).toBe(false);
      expect(provider.hasCapability('embedding')).toBe(false);
    });
  });

  describe('listModels', () => {
    it('should list available models', async () => {
      mockListModels.mockResolvedValueOnce({
        data: [
          {
            id: 'gpt-4',
            object: 'model',
            created: 1700000000,
            owned_by: 'openai',
          },
          {
            id: 'gpt-3.5-turbo',
            object: 'model',
            created: 1700000000,
            owned_by: 'openai',
          },
        ],
      });

      const provider = createOpenAICompatibleProvider({ apiKey: 'test-key' });
      const result = await provider.listModels();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBeGreaterThan(0);
        expect(result.value[0]?.providerId).toBe('openai-compatible');
      }
    });

    it('should return error on API failure', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const error = new Error('Unauthorized') as any;
      error.status = 401;
      mockListModels.mockRejectedValueOnce(error);

      const provider = createOpenAICompatibleProvider({ apiKey: 'test-key' });
      const result = await provider.listModels();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        // The adapter normalizes unknown errors to provider.unknown
        expect(result.error.code).toBe('provider.unknown');
      }
    });
  });

  describe('getModel', () => {
    it('should return model descriptor for known models', async () => {
      const provider = createOpenAICompatibleProvider({ apiKey: 'test-key' });
      const result = await provider.getModel('gpt-4');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe('gpt-4');
        expect(result.value.providerId).toBe('openai-compatible');
        expect(result.value.name).toBe('GPT-4');
      }
    });

    it('should return descriptor for unknown models', async () => {
      mockRetrieveModel.mockRejectedValueOnce(new Error('Not found'));

      const provider = createOpenAICompatibleProvider({ apiKey: 'test-key' });
      const result = await provider.getModel('non-existent-model');

      // The adapter returns a generic descriptor for unknown models
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe('non-existent-model');
      }
    });
  });

  describe('invoke', () => {
    it('should successfully invoke the model', async () => {
      mockCreateCompletion.mockResolvedValueOnce({
        id: 'chatcmpl_123',
        object: 'chat.completion',
        created: 1700000000,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hello!' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      const provider = createOpenAICompatibleProvider({ apiKey: 'test-key' });
      const request: ModelRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const result = await provider.invoke(request);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe('chatcmpl_123');
        expect(result.value.model).toBe('gpt-4');
        expect(result.value.providerId).toBe('openai-compatible');
        expect(result.value.content).toBe('Hello!');
        expect(result.value.finishReason).toBe('stop');
        expect(result.value.usage.totalTokens).toBe(15);
      }
    });

    it('should return error when tools not supported', async () => {
      const provider = createOpenAICompatibleProvider({
        apiKey: 'test-key',
        enableTools: false,
      });

      const request: ModelRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
        tools: [
          { name: 'test', description: 'Test', parameters: { type: 'object' } },
        ],
      };

      const result = await provider.invoke(request);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('provider.capability_unsupported');
      }
    });

    it('should normalize API errors', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const error = new Error('Rate limit exceeded') as any;
      error.status = 429;
      error.headers = { get: () => '60' };
      mockCreateCompletion.mockRejectedValueOnce(error);

      const provider = createOpenAICompatibleProvider({ apiKey: 'test-key' });
      const result = await provider.invoke({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        // The adapter normalizes unknown errors to provider.unknown
        // (Only OpenAI.APIError instances get special handling)
        expect(result.error.code).toBe('provider.unknown');
      }
    });
  });

  describe('logging', () => {
    const request: ModelRequest = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
    };

    it('logs info on invoke with model and baseURL', async () => {
      mockCreateCompletion.mockResolvedValueOnce({
        id: 'chatcmpl_log',
        object: 'chat.completion',
        created: 1700000000,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hi' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      });

      const provider = createOpenAICompatibleProvider({ apiKey: 'test-key' });
      await provider.invoke(request);

      expect(mockLoggerInstance.info).toHaveBeenCalledWith(
        expect.stringContaining('invoke: model=gpt-4'),
      );
    });

    it('logs info on invokeStream with model and baseURL', async () => {
      const mockStream = (async function* () {
        yield {
          id: 'chatcmpl_stream',
          choices: [{ delta: { content: 'Hi' }, finish_reason: 'stop' }],
        };
      })();
      mockCreateCompletion.mockResolvedValueOnce(mockStream);

      const provider = createOpenAICompatibleProvider({ apiKey: 'test-key' });
      for await (const _ of provider.invokeStream(request)) {
        // consume
      }

      expect(mockLoggerInstance.info).toHaveBeenCalledWith(
        expect.stringContaining('invokeStream: model=gpt-4'),
      );
    });

    it('logs error when invoke receives an OpenAI APIError', async () => {
      const OpenAI = (await import('openai')).default as unknown as {
        APIError: new (
          msg: string,
          code: string,
          type: string,
        ) => Error & {
          status: number;
          error: unknown;
        };
      };
      const apiError = new OpenAI.APIError(
        'Unknown Model',
        '1211',
        'invalid_request_error',
      );
      apiError.status = 400;
      apiError.error = { code: '1211', message: 'Unknown Model' };
      mockCreateCompletion.mockRejectedValueOnce(apiError);

      const provider = createOpenAICompatibleProvider({
        apiKey: 'test-key',
        providerId: 'minimax',
      });
      const result = await provider.invoke(request);

      expect(result.ok).toBe(false);
      expect(mockLoggerInstance.error).toHaveBeenCalledWith(
        expect.stringContaining('Provider API error: HTTP'),
        expect.objectContaining({ code: '1211' }),
      );
    });

    it('logs error when invokeStream receives an OpenAI APIError', async () => {
      const OpenAI = (await import('openai')).default as unknown as {
        APIError: new (
          msg: string,
          code: string,
          type: string,
        ) => Error & {
          status: number;
          error: unknown;
        };
      };
      const apiError = new OpenAI.APIError(
        'Not Found',
        undefined as unknown as string,
        undefined as unknown as string,
      );
      apiError.status = 404;
      apiError.error = undefined;
      mockCreateCompletion.mockRejectedValueOnce(apiError);

      const provider = createOpenAICompatibleProvider({ apiKey: 'test-key' });
      const events = [];
      for await (const event of provider.invokeStream(request)) {
        events.push(event);
      }

      expect(events.some((e) => !e.ok)).toBe(true);
      expect(mockLoggerInstance.error).toHaveBeenCalledWith(
        expect.stringContaining('Provider API error: HTTP'),
        expect.any(Object),
      );
    });

    it('logs error for generic Error in invoke', async () => {
      mockCreateCompletion.mockRejectedValueOnce(new Error('Network failure'));

      const provider = createOpenAICompatibleProvider({ apiKey: 'test-key' });
      const result = await provider.invoke(request);

      expect(result.ok).toBe(false);
      expect(mockLoggerInstance.error).toHaveBeenCalledWith(
        expect.stringContaining('Network failure'),
      );
    });

    it('uses providerId as logger context', async () => {
      const { createLogger } = await import('../../../lib/logger');
      createOpenAICompatibleProvider({
        apiKey: 'test-key',
        providerId: 'my-provider',
      });
      expect(createLogger).toHaveBeenCalledWith('my-provider');
    });
  });

  describe('invokeStream', () => {
    it('should return error when streaming not supported', async () => {
      const provider = createOpenAICompatibleProvider({
        apiKey: 'test-key',
        enableStreaming: false,
      });

      const events = [];
      for await (const event of provider.invokeStream({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
      })) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      const firstEvent = events[0];
      expect(firstEvent?.ok).toBe(false);
      if (firstEvent && !firstEvent.ok) {
        expect(firstEvent.error.code).toBe('provider.capability_unsupported');
      }
    });

    it('should stream model output', async () => {
      // Mock async iterable for streaming
      const mockStream = (async function* () {
        yield {
          id: 'chatcmpl_123',
          choices: [{ delta: { role: 'assistant' }, finish_reason: null }],
        };
        yield {
          id: 'chatcmpl_123',
          choices: [{ delta: { content: 'Hello' }, finish_reason: null }],
        };
        yield {
          id: 'chatcmpl_123',
          choices: [{ delta: {}, finish_reason: 'stop' }],
        };
      })();

      mockCreateCompletion.mockResolvedValueOnce(mockStream);

      const provider = createOpenAICompatibleProvider({ apiKey: 'test-key' });
      const events = [];

      for await (const event of provider.invokeStream({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
      })) {
        events.push(event);
      }

      // Should have started, content_delta, and finished events
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]?.ok).toBe(true);
      if (events[0]?.ok) {
        expect(events[0].value.type).toBe('stream.started');
      }
    });
  });
});

describe('Factory functions', () => {
  it('createOpenAIProvider should create provider with OpenAI defaults', () => {
    const provider = createOpenAIProvider('test-key');

    expect(provider.descriptor.id).toBe('openai');
    expect(provider.descriptor.name).toBe('OpenAI');
  });

  it('createCompatibleProvider should create provider with custom baseUrl', () => {
    const provider = createCompatibleProvider(
      'http://localhost:11434/v1',
      'local-key',
      {
        providerId: 'ollama',
        providerName: 'Ollama',
      },
    );

    expect(provider.descriptor.id).toBe('ollama');
    expect(provider.descriptor.name).toBe('Ollama');
  });
});
