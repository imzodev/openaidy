/**
 * Provider Registry
 *
 * Manages ProviderProfile instances with lazy discovery of built-in
 * provider profiles from ./deepseek/, ./minimax/, ./groq/, ./openrouter/.
 *
 * User plugins can override built-in profiles by registering a profile
 * with the same id before the lazy discovery runs (or by calling reset()
 * and re-registering).
 */

import { ProviderProfile, type ProviderProfileInput } from './types';

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
   * Each built-in provider module calls `registry.register(profile)` at
   * module level, so importing it registers the profile automatically.
   *
   * Uses @vite-ignore to suppress Vite's "Unknown variable dynamic import"
   * warning when provider directories don't exist yet (they're added later).
   */
  private _discover(): void {
    this._discovered = true;

    const builtInProviders = [
      'deepseek',
      'minimax',
      'groq',
      'openrouter',
    ] as const;

    for (const name of builtInProviders) {
      try {
        // @vite-ignore suppresses "Unknown variable dynamic import" for optional providers
         
        void import(/* @vite-ignore */ `./${name}/index.js`);
      } catch {
        // Provider directory doesn't exist or has no index — skip silently
      }
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
