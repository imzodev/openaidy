/**
 * ProviderProfile Tests
 *
 * Verifies: construction, schema validation, field defaults,
 * hook accessors, overridable hook methods.
 */

import { describe, it, expect } from 'vitest';
import { ProviderProfile } from './types';

describe('ProviderProfile', () => {
  describe('constructor + static create()', () => {
    it('should create a profile with required fields', () => {
      const profile = ProviderProfile.create({
        id: 'deepseek',
        name: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
      });
      expect(profile.id).toBe('deepseek');
      expect(profile.name).toBe('DeepSeek');
      expect(profile.baseUrl).toBe('https://api.deepseek.com');
    });

    it('static create() should be an alias for constructor', () => {
      const p1 = ProviderProfile.create({ id: 't', name: 'T' });
      const p2 = new ProviderProfile({ id: 't', name: 'T' });
      expect(p1.id).toBe(p2.id);
    });

    it('should default apiMode to openai-compatible', () => {
      const profile = ProviderProfile.create({ id: 'test', name: 'Test' });
      expect(profile.apiMode).toBe('openai-compatible');
    });

    it('should default auth to api_key with empty envVars', () => {
      const profile = ProviderProfile.create({ id: 'test', name: 'Test' });
      expect(profile.auth.type).toBe('api_key');
      expect(profile.auth.envVars).toEqual([]);
    });

    it('should default aliases to empty array', () => {
      const profile = ProviderProfile.create({ id: 'test', name: 'Test' });
      expect(profile.aliases).toEqual([]);
    });

    it('should default models to empty array', () => {
      const profile = ProviderProfile.create({ id: 'test', name: 'Test' });
      expect(profile.models).toEqual([]);
    });

    it('should default supportsHealthCheck to true', () => {
      const profile = ProviderProfile.create({ id: 'test', name: 'Test' });
      expect(profile.supportsHealthCheck).toBe(true);
    });

    it('should store aliases', () => {
      const profile = ProviderProfile.create({
        id: 'deepseek',
        name: 'DeepSeek',
        aliases: ['deepseek-chat'],
      });
      expect(profile.aliases).toEqual(['deepseek-chat']);
    });

    it('should store models with capabilities', () => {
      const profile = ProviderProfile.create({
        id: 'test',
        name: 'Test',
        models: [
          {
            id: 'gpt-4',
            capabilities: ['text_generation', 'streaming'],
          },
        ],
      });
      expect(profile.models).toHaveLength(1);
      const m = profile.models[0]!;
      expect(m.id).toBe('gpt-4');
      expect(m.capabilities).toEqual(['text_generation', 'streaming']);
    });

    it('should store displayName, description, signupUrl', () => {
      const profile = ProviderProfile.create({
        id: 'deepseek',
        name: 'DeepSeek',
        displayName: 'DeepSeek AI',
        description: 'DeepSeek provider',
        signupUrl: 'https://platform.deepseek.com/',
      });
      expect(profile.displayName).toBe('DeepSeek AI');
      expect(profile.description).toBe('DeepSeek provider');
      expect(profile.signupUrl).toBe('https://platform.deepseek.com/');
    });

    it('should store vendorFamily', () => {
      const profile = ProviderProfile.create({
        id: 'deepseek',
        name: 'DeepSeek',
        vendorFamily: 'openai-compatible',
      });
      expect(profile.vendorFamily).toBe('openai-compatible');
    });

    it('should store defaultHeaders', () => {
      const profile = ProviderProfile.create({
        id: 'test',
        name: 'Test',
        defaultHeaders: { 'X-Custom': 'value' },
      });
      expect(profile.defaultHeaders).toEqual({ 'X-Custom': 'value' });
    });

    it('should store fixedTemperature', () => {
      const profile = ProviderProfile.create({
        id: 'test',
        name: 'Test',
        fixedTemperature: 0.7,
      });
      expect(profile.fixedTemperature).toBe(0.7);
    });

    it('should store defaultMaxTokens and defaultAuxModel', () => {
      const profile = ProviderProfile.create({
        id: 'test',
        name: 'Test',
        defaultMaxTokens: 4096,
        defaultAuxModel: 'claude-sonnet-4-6',
      });
      expect(profile.defaultMaxTokens).toBe(4096);
      expect(profile.defaultAuxModel).toBe('claude-sonnet-4-6');
    });
  });

  describe('schema validation', () => {
    it('should accept valid profile data', () => {
      expect(() =>
        ProviderProfile.create({
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
        }),
      ).not.toThrow();
    });

    it('should throw on missing id', () => {
      expect(() =>
        // @ts-expect-error — intentionally incomplete for test
        ProviderProfile.create({ name: 'Test' }),
      ).toThrow();
    });

    it('should throw on missing name', () => {
      expect(() =>
        // @ts-expect-error — intentionally incomplete for test
        ProviderProfile.create({ id: 'test' }),
      ).toThrow();
    });

    it('should throw on invalid apiMode', () => {
      expect(() =>
        ProviderProfile.create({
          id: 'test',
          name: 'Test',
          // @ts-expect-error — intentionally invalid for test
          apiMode: 'invalid',
        }),
      ).toThrow();
    });

    it('should throw on fixedTemperature out of range', () => {
      expect(() =>
        ProviderProfile.create({
          id: 'test',
          name: 'Test',
          fixedTemperature: 3,
        }),
      ).toThrow();
    });
  });

  describe('hook accessors', () => {
    it('should return empty arrays for hook accessors by default', () => {
      const profile = ProviderProfile.create({ id: 'test', name: 'Test' });
      expect(profile.buildRequestHooks).toEqual([]);
      expect(profile.onStreamChunkHooks).toEqual([]);
      expect(profile.prepareMessagesHooks).toEqual([]);
    });
  });

  describe('overridable methods', () => {
    it('buildExtraBody returns empty by default', () => {
      const profile = ProviderProfile.create({ id: 'test', name: 'Test' });
      const result = profile.buildExtraBody({
        model: 'gpt-4',
        vendorFamily: 'openai-compatible',
      });
      expect(result).toEqual({ extraBody: {}, topLevel: {}, headers: {} });
    });

    it('onStreamChunk returns chunk unchanged by default', () => {
      const profile = ProviderProfile.create({ id: 'test', name: 'Test' });
      const chunk = { delta: 'hello' } as const;
      const result = profile.onStreamChunk(chunk, {
        model: 'gpt-4',
        vendorFamily: 'openai-compatible' as const,
      });
      expect(result).toBe(chunk);
    });

    it('prepareMessages returns messages unchanged by default', () => {
      const profile = ProviderProfile.create({ id: 'test', name: 'Test' });
      const msgs = [{ role: 'user', content: 'hi' }] as const;
      const result = profile.prepareMessages([...msgs], {
        model: 'gpt-4',
        vendorFamily: 'openai-compatible',
      });
      expect(result).toEqual([...msgs]);
    });

    it('getMaxTokens returns undefined by default', () => {
      const profile = ProviderProfile.create({ id: 'test', name: 'Test' });
      expect(profile.getMaxTokens('gpt-4')).toBeUndefined();
    });

    it('getBaseUrl returns baseUrl field', () => {
      const profile = ProviderProfile.create({
        id: 'test',
        name: 'Test',
        baseUrl: 'https://api.test.dev',
      });
      expect(profile.getBaseUrl()).toBe('https://api.test.dev');
    });

    it('resolveModel returns modelHint when provided', () => {
      const profile = ProviderProfile.create({
        id: 'test',
        name: 'Test',
        defaultModel: 'gpt-4',
      });
      expect(profile.resolveModel('custom-model')).toBe('custom-model');
    });

    it('resolveModel returns defaultModel when no hint', () => {
      const profile = ProviderProfile.create({
        id: 'test',
        name: 'Test',
        defaultModel: 'gpt-4',
      });
      expect(profile.resolveModel()).toBe('gpt-4');
      expect(profile.resolveModel(undefined)).toBe('gpt-4');
    });
  });
});
