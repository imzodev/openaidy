import { describe, it, expect } from 'vitest';
import type { ModelRequest } from '@aidyagent/runtime';
import { reasoningRequestParams } from './openai-compatible/reasoning.js';
import { mapThinkingConfig } from './gemini/request-mapper';
import { mapRequest as mapAnthropicRequest } from './anthropic/request-mapper';

const request = (model: string, effort?: ModelRequest['reasoningEffort']) =>
  ({
    model,
    messages: [{ role: 'user', content: 'hi' }],
    ...(effort ? { reasoningEffort: effort } : {}),
  }) as ModelRequest;

describe('OpenAI-compatible reasoning params', () => {
  it('turns DeepSeek thinking off', () => {
    expect(reasoningRequestParams('deepseek-v4-flash', 'off')).toEqual({
      thinking: { type: 'disabled' },
    });
  });

  it('sets DeepSeek effort, rounding medium up to high', () => {
    expect(reasoningRequestParams('deepseek-v4-flash', 'max')).toEqual({
      thinking: { type: 'enabled' },
      reasoning_effort: 'max',
    });
    expect(reasoningRequestParams('deepseek-v4-pro', 'medium')).toEqual({
      thinking: { type: 'enabled' },
      reasoning_effort: 'high',
    });
  });

  it('works for DeepSeek served through a gateway', () => {
    expect(
      reasoningRequestParams('opencode-go/deepseek-v4-flash', 'low'),
    ).toEqual({ thinking: { type: 'enabled' }, reasoning_effort: 'low' });
  });

  it('sets reasoning_effort for OpenAI reasoning models', () => {
    expect(reasoningRequestParams('o3', 'medium')).toEqual({
      reasoning_effort: 'medium',
    });
  });

  it('sends nothing for Auto or unknown models', () => {
    expect(reasoningRequestParams('deepseek-v4-flash', undefined)).toEqual({});
    expect(reasoningRequestParams('gpt-4o', 'high')).toEqual({});
    expect(reasoningRequestParams('mimo-v2.5', 'high')).toEqual({});
  });

  it('moves a level the model lacks to the closest one', () => {
    expect(reasoningRequestParams('o3', 'off')).toEqual({
      reasoning_effort: 'low',
    });
    expect(reasoningRequestParams('o3', 'max')).toEqual({
      reasoning_effort: 'high',
    });
  });
});

describe('Gemini thinkingConfig', () => {
  it('uses a token budget on 2.5, 0 for off', () => {
    expect(mapThinkingConfig(request('gemini-2.5-flash', 'off'))).toEqual({
      thinkingBudget: 0,
    });
    expect(mapThinkingConfig(request('gemini-2.5-flash', 'low'))).toEqual({
      thinkingBudget: 1024,
    });
    expect(mapThinkingConfig(request('gemini-2.5-pro', 'high'))).toEqual({
      thinkingBudget: 32768,
    });
  });

  it('uses a level on Gemini 3', () => {
    expect(mapThinkingConfig(request('gemini-3.5-flash', 'low'))).toEqual({
      thinkingLevel: 'low',
    });
    expect(mapThinkingConfig(request('gemini-3.5-flash', 'high'))).toEqual({
      thinkingLevel: 'high',
    });
  });

  it('leaves the model default for Auto and unsupported models', () => {
    expect(mapThinkingConfig(request('gemini-2.5-flash'))).toBeUndefined();
    expect(
      mapThinkingConfig(request('gemini-2.0-flash', 'high')),
    ).toBeUndefined();
  });

  it("gives Gemini 2.5 Pro, which can't stop thinking, the lowest budget for off", () => {
    expect(mapThinkingConfig(request('gemini-2.5-pro', 'off'))).toEqual({
      thinkingBudget: 1024,
    });
  });
});

describe('Anthropic output_config.effort', () => {
  it('sets effort on Claude 4.6+', () => {
    expect(
      mapAnthropicRequest(request('claude-opus-4-7', 'max')).output_config,
    ).toEqual({ effort: 'max' });
  });

  it('sends nothing for older models, Auto, or off', () => {
    expect(
      mapAnthropicRequest(request('claude-haiku-4-5', 'high')).output_config,
    ).toBeUndefined();
    expect(
      mapAnthropicRequest(request('claude-opus-4-7')).output_config,
    ).toBeUndefined();
    expect(
      mapAnthropicRequest(request('claude-opus-4-7', 'off')).output_config,
    ).toBeUndefined();
  });
});
