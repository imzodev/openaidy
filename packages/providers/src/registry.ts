/**
 * Provider Registry
 *
 * Manages ProviderProfile instances with lazy discovery of built-in
 * provider profiles from ./deepseek/, ./minimax/, ./groq/, ./openrouter/,
 * ./openai/, ./anthropic/, ./google/.
 *
 * User plugins can override built-in profiles by registering a profile
 * with the same id before the lazy discovery runs (or by calling reset()
 * and re-registering).
 */

import { ProviderProfile, type ProviderProfileInput } from './types';

// Static imports for built-in providers
// Each module calls registry.register() at module level when imported
import { AnthropicProfile } from './anthropic/index';
import { DeepSeekProfile } from './deepseek/index';
import { GoogleProfile } from './google/index';
import { GroqProfile } from './groq/index';
import { MiniMaxProfile } from './minimax/index';
import { OpenAIProfile } from './openai/index';
import { OpenRouterProfile } from './openrouter/index';

const builtInProfiles: ProviderProfile[] = [
  new AnthropicProfile(),
  new DeepSeekProfile(),
  new GoogleProfile(),
  new GroqProfile(),
  new MiniMaxProfile(),
  new OpenAIProfile(),
  new OpenRouterProfile(),
];

export class ProviderRegistry {
  private _profiles = new Map<string, ProviderProfile>();
  private _aliases = new Map<string, string>();
  private _discovered = false;

  // ── Registration ─────────────────────────────────────────────────────────────

  /**
   * Register a profile. Accepts either a ProviderProfile instance or a
   * plain data object (which is converted to a ProviderProfile).
   * Later registrations with the same id replace earlier ones.
   */
  register(profile: ProviderProfile | ProviderProfileInput): this {
    const p =
      profile instanceof ProviderProfile
        ? profile
        : new ProviderProfile(profile);

    this._profiles.set(p.id, p);
    for (const alias of p.aliases) {
      this._aliases.set(alias, p.id);
    }
    return this;
  }

  /**
   * Unregister a profile by id (useful for testing / hot-reload).
   */
  unregister(id: string): boolean {
    return this._profiles.delete(id);
  }

  // ── Lookup ──────────────────────────────────────────────────────────────────

  /**
   * Get a profile by canonical id or alias.
   * Triggers lazy discovery on first call.
   */
  get(nameOrAlias: string): ProviderProfile | undefined {
    if (!this._discovered) {
      this._discover();
    }
    const canonical = this._aliases.get(nameOrAlias) ?? nameOrAlias;
    return this._profiles.get(canonical);
  }

  /**
   * List all registered profiles (one per canonical id).
   * Triggers lazy discovery on first call.
   */
  list(): readonly ProviderProfile[] {
    if (!this._discovered) {
      this._discover();
    }
    return [...this._profiles.values()];
  }

  /**
   * Check if a profile exists (by id or alias).
   */
  has(nameOrAlias: string): boolean {
    return this.get(nameOrAlias) !== undefined;
  }

  // ── Discovery ───────────────────────────────────────────────────────────────

  /**
   * Discover and register all built-in provider profiles.
   *
   * Built-in providers are statically imported above and registered here.
   * User plugins can override built-in profiles by registering before
   * calling list() or get(), or by calling reset() and re-registering.
   */
  private _discover(): void {
    this._discovered = true;

    // Register all built-in profiles
    for (const profile of builtInProfiles) {
      this.register(profile);
    }
  }

  /**
   * Reset discovery state and clear all registrations.
   * Useful for testing.
   */
  reset(): void {
    this._discovered = false;
    this._profiles.clear();
    this._aliases.clear();
  }
}

// ── Global registry singleton ─────────────────────────────────────────────────

export const registry = new ProviderRegistry();
