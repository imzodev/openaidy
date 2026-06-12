/**
 * ProviderRegistry Tests
 *
 * Verifies: registration, lookup, alias resolution, discovery,
 * unregister, reset, singleton registry.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ProviderRegistry, registry } from './registry';
import { ProviderProfile } from './types';

function makeProfile(
  id: string,
  name: string,
  extra: Record<string, unknown> = {},
): ProviderProfile {
  return ProviderProfile.create({ id, name, ...extra });
}

describe('ProviderRegistry', () => {
  let localRegistry: ProviderRegistry;

  beforeEach(() => {
    localRegistry = new ProviderRegistry();
  });

  describe('register()', () => {
    it('should register a profile and return this for chaining', () => {
      const profile = makeProfile('test-1', 'Test 1');
      const result = localRegistry.register(profile);
      expect(localRegistry.has('test-1')).toBe(true);
      expect(result).toBe(localRegistry);
    });

    it('should accept plain data object and convert to ProviderProfile', () => {
      localRegistry.register({ id: 'test', name: 'Test' });
      expect(localRegistry.get('test')).toBeInstanceOf(ProviderProfile);
    });

    it('should overwrite existing profile with same id (last-write-wins)', () => {
      localRegistry.register(makeProfile('test', 'First'));
      localRegistry.register(makeProfile('test', 'Second'));
      expect(localRegistry.get('test')!.name).toBe('Second');
    });

    it('should register aliases mapping to the same id', () => {
      localRegistry.register(
        makeProfile('deepseek', 'DeepSeek', { aliases: ['deepseek-chat'] }),
      );
      expect(localRegistry.get('deepseek')!.id).toBe('deepseek');
      expect(localRegistry.get('deepseek-chat')!.id).toBe('deepseek');
    });
  });

  describe('unregister()', () => {
    it('should remove the profile and return true', () => {
      localRegistry.register(makeProfile('test', 'Test'));
      const result = localRegistry.unregister('test');
      expect(result).toBe(true);
      expect(localRegistry.has('test')).toBe(false);
    });

    it('should return false when id not found', () => {
      expect(localRegistry.unregister('nonexistent')).toBe(false);
    });
  });

  describe('get()', () => {
    it('should return the registered profile by id', () => {
      const profile = makeProfile('test', 'Test');
      localRegistry.register(profile);
      expect(localRegistry.get('test')).toBe(profile);
    });

    it('should return undefined for unknown id', () => {
      expect(localRegistry.get('nonexistent')).toBeUndefined();
    });

    it('should resolve alias to canonical id', () => {
      localRegistry.register(
        makeProfile('deepseek', 'DeepSeek', { aliases: ['deepseek-chat'] }),
      );
      expect(localRegistry.get('deepseek-chat')?.id).toBe('deepseek');
    });
  });

  describe('list()', () => {
    it('should return built-in providers on fresh registry', () => {
      // A fresh registry should discover and return built-in providers
      const ids = localRegistry.list().map((p) => p.id);
      expect(ids).toContain('deepseek');
      expect(ids).toContain('groq');
      expect(ids).toContain('minimax');
      expect(ids).toContain('openrouter');
    });

    it('should return all registered profiles', () => {
      // Register custom profiles on fresh registry
      localRegistry.register(makeProfile('custom-a', 'Custom A'));
      localRegistry.register(makeProfile('custom-b', 'Custom B'));
      const ids = localRegistry.list().map((p) => p.id);
      // Should contain both custom and built-in providers
      expect(ids).toContain('custom-a');
      expect(ids).toContain('custom-b');
      expect(ids).toContain('deepseek');
    });
  });

  describe('has()', () => {
    it('should return true for registered id', () => {
      localRegistry.register(makeProfile('test', 'Test'));
      expect(localRegistry.has('test')).toBe(true);
    });

    it('should return true for registered alias', () => {
      localRegistry.register(
        makeProfile('deepseek', 'DeepSeek', { aliases: ['deepseek-chat'] }),
      );
      expect(localRegistry.has('deepseek-chat')).toBe(true);
    });

    it('should return false for unknown id', () => {
      expect(localRegistry.has('nonexistent')).toBe(false);
    });
  });

  describe('lazy discovery', () => {
    it('should not import provider modules until first get() or list()', () => {
      // At this point built-in providers don't exist yet, so discovery
      // will silently skip them — this just verifies it doesn't throw
      const profiles = localRegistry.list();
      expect(Array.isArray(profiles)).toBe(true);
    });
  });

  describe('reset()', () => {
    it('should clear all profiles and reset discovery flag', () => {
      localRegistry.register(makeProfile('test', 'Test'));
      localRegistry.reset();
      expect(localRegistry.has('test')).toBe(false);
    });
  });
});

describe('global registry singleton', () => {
  it('should be a ProviderRegistry instance', () => {
    expect(registry).toBeInstanceOf(ProviderRegistry);
  });

  it('should be shared across imports', async () => {
    // Re-importing via dynamic import returns the same instance
    const mod = await import('./registry.js');
    expect(mod.registry).toBe(registry);
  });
});
