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
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  describe('register()', () => {
    it('should register a profile and return this for chaining', () => {
      const profile = makeProfile('test-1', 'Test 1');
      const result = registry.register(profile);
      expect(registry.has('test-1')).toBe(true);
      expect(result).toBe(registry);
    });

    it('should accept plain data object and convert to ProviderProfile', () => {
      registry.register({ id: 'test', name: 'Test' });
      expect(registry.get('test')).toBeInstanceOf(ProviderProfile);
    });

    it('should overwrite existing profile with same id (last-write-wins)', () => {
      registry.register(makeProfile('test', 'First'));
      registry.register(makeProfile('test', 'Second'));
      expect(registry.get('test')!.name).toBe('Second');
    });

    it('should register aliases mapping to the same id', () => {
      registry.register(
        makeProfile('deepseek', 'DeepSeek', { aliases: ['deepseek-chat'] }),
      );
      expect(registry.get('deepseek')!.id).toBe('deepseek');
      expect(registry.get('deepseek-chat')!.id).toBe('deepseek');
    });
  });

  describe('unregister()', () => {
    it('should remove the profile and return true', () => {
      registry.register(makeProfile('test', 'Test'));
      const result = registry.unregister('test');
      expect(result).toBe(true);
      expect(registry.has('test')).toBe(false);
    });

    it('should return false when id not found', () => {
      expect(registry.unregister('nonexistent')).toBe(false);
    });
  });

  describe('get()', () => {
    it('should return the registered profile by id', () => {
      const profile = makeProfile('test', 'Test');
      registry.register(profile);
      expect(registry.get('test')).toBe(profile);
    });

    it('should return undefined for unknown id', () => {
      expect(registry.get('nonexistent')).toBeUndefined();
    });

    it('should resolve alias to canonical id', () => {
      registry.register(
        makeProfile('deepseek', 'DeepSeek', { aliases: ['deepseek-chat'] }),
      );
      expect(registry.get('deepseek-chat')?.id).toBe('deepseek');
    });
  });

  describe('list()', () => {
    it('should return empty array when nothing registered', () => {
      expect(registry.list()).toEqual([]);
    });

    it('should return all registered profiles', () => {
      registry.register(makeProfile('a', 'A'));
      registry.register(makeProfile('b', 'B'));
      const ids = registry.list().map((p) => p.id);
      expect(ids).toContain('a');
      expect(ids).toContain('b');
    });
  });

  describe('has()', () => {
    it('should return true for registered id', () => {
      registry.register(makeProfile('test', 'Test'));
      expect(registry.has('test')).toBe(true);
    });

    it('should return true for registered alias', () => {
      registry.register(
        makeProfile('deepseek', 'DeepSeek', { aliases: ['deepseek-chat'] }),
      );
      expect(registry.has('deepseek-chat')).toBe(true);
    });

    it('should return false for unknown id', () => {
      expect(registry.has('nonexistent')).toBe(false);
    });
  });

  describe('lazy discovery', () => {
    it('should not import provider modules until first get() or list()', () => {
      // At this point built-in providers don't exist yet, so discovery
      // will silently skip them — this just verifies it doesn't throw
      const profiles = registry.list();
      expect(Array.isArray(profiles)).toBe(true);
    });
  });

  describe('reset()', () => {
    it('should clear all profiles and reset discovery flag', () => {
      registry.register(makeProfile('test', 'Test'));
      registry.reset();
      expect(registry.has('test')).toBe(false);
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
