# Provider Profile Registry — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Replace hardcoded `vendorFamily` enum + `isDeepSeek` branching with a Hermes-style plugin registry where each provider declares its own identity, endpoints, auth, quirks, and request hooks via a `ProviderProfile`.

**Architecture:**

- `ProviderProfile` dataclass — declarative, pure data, no SDK deps
- `ProviderRegistry` — discovers profiles from `packages/providers/src/` via `pkgutil` (no `npm link` needed)
- Profiles live in `packages/providers/src/<provider>/index.ts` — one dir per provider, zero config files
- Hooks: `buildRequest()`, `prepareMessages()`, `onStreamChunk()` — called by the adapter, not spread through if/else chains
- Backward-compatible: existing `vendorFamilySchema` + `appProviderConfigSchema` remain the config-layer entry point; profiles are the runtime layer

**Tech Stack:** TypeScript, Zod, Node.js `pkgutil` for discovery (mirrors Hermes's approach without requiring a bundler)

---

## Before You Start

Read these files to understand the current state:

```
apps/server/src/providers/infrastructure/openai-compatible/adapter.ts   # lines 300-530 (DeepSeek branching)
packages/config/src/provider/base.ts                                        # vendorFamilySchema
packages/shared-types/src/providers-preset.ts                              # existing presets (read-only)
packages/runtime/src/adapter-contract.ts                                   # ModelProvider interface
```

---

## Directory Structure (After)

```
packages/providers/
├── src/
│   ├── index.ts                    # exports ProviderRegistry, profiles
│   ├── registry.ts                 # discover + register profiles
│   ├── types.ts                    # ProviderProfile interface + related types
│   ├── hooks.ts                    # hook signature types (buildRequest, onStreamChunk, etc.)
│   ├── deepseek/
│   │   ├── index.ts                # DeepSeekProfile extends ProviderProfile
│   │   └── deepseek.test.ts
│   ├── minimax/
│   │   ├── index.ts                # MiniMaxProfile extends ProviderProfile
│   │   └── minimax.test.ts
│   ├── groq/
│   │   ├── index.ts                # GroqProfile
│   │   └── groq.test.ts
│   └── openrouter/
│       ├── index.ts                # OpenRouterProfile
│       └── openrouter.test.ts
└── package.json
```

---

## Task 1: Create `packages/providers` package scaffold

**Objective:** Create the new package with package.json, tsconfig, and exports

**Files:**

- Create: `packages/providers/package.json`
- Create: `packages/providers/tsconfig.json`
- Create: `packages/providers/src/index.ts`
- Create: `packages/providers/src/types.ts`
- Create: `packages/providers/src/hooks.ts`
- Create: `packages/providers/src/registry.ts`

**Step 1: Create package.json**

```json
{
  "name": "@openaidy/providers",
  "version": "0.1.0",
  "description": "Provider profile registry — declarative provider config with runtime hooks",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": "./dist/index.js",
    "./registry": "./dist/registry.js",
    "./hooks": "./dist/hooks.js",
    "./deepseek": "./dist/deepseek/index.js",
    "./minimax": "./dist/minimax/index.js",
    "./groq": "./dist/groq/index.js",
    "./openrouter": "./dist/openrouter/index.js"
  },
  "scripts": {
    "build": "tsc --project tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@openaidy/shared-types": "workspace:*"
  },
  "devDependencies": {
    "vitest": "^3.0.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

**Step 3: Run build to verify scaffold**

Run: `cd /tmp/openaidy/packages/providers && pnpm install` (or `pnpm add -w` from repo root)
Expected: no errors

---

## Task 2: Define `ProviderProfile` types

**Objective:** Define the core `ProviderProfile` interface and hook signatures in `types.ts` and `hooks.ts`

**Files:**

- Modify: `packages/providers/src/types.ts` (create)
- Modify: `packages/providers/src/hooks.ts` (create)

**Step 1: Write failing test**

```typescript
// packages/providers/src/types.test.ts
import { describe, it, expect } from 'vitest';
import { ProviderProfile } from './types';

describe('ProviderProfile', () => {
  it('should allow creating a profile with required fields', () => {
    const profile = ProviderProfile.create({
      id: 'deepseek',
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
    });
    expect(profile.id).toBe('deepseek');
    expect(profile.name).toBe('DeepSeek');
  });

  it('should not allow creating a profile without id or name', () => {
    expect(() =>
      ProviderProfile.create({ id: '', name: 'DeepSeek' }),
    ).toThrow();
    expect(() =>
      ProviderProfile.create({ id: 'deepseek', name: '' }),
    ).toThrow();
  });
});
```

Run: `cd /tmp/openaidy/packages/providers && pnpm test -- types.test.ts`
Expected: FAIL — `ProviderProfile` not defined

**Step 2: Write the types**

```typescript
// packages/providers/src/types.ts

import { z } from 'zod';

// ── Schema ──────────────────────────────────────────────────────────────────

export const providerProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Default base URL for API requests */
  baseUrl: z.string().url().optional(),
  /** Auth configuration */
  auth: z
    .object({
      type: z.enum(['api_key', 'oauth', 'device_code', 'aws_sdk']),
      envVars: z.array(z.string()).default([]),
    })
    .optional(),
  /** Aliases for this provider (e.g. 'deepseek-chat' → 'deepseek') */
  aliases: z.array(z.string()).default([]),
  /** API mode — determines how requests are built and sent */
  apiMode: z
    .enum([
      'openai-compatible', // OpenAI SDK, /chat/completions
      'anthropic-messages', // Anthropic messages API
      'gemini', // Google Gemini API
      'custom', // Raw request — caller provides everything
    ])
    .default('openai-compatible'),
  /** Default model when none specified */
  defaultModel: z.string().optional(),
  /** Models available from this provider (static list — for presets) */
  models: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        capabilities: z
          .array(
            z.enum([
              'text_generation',
              'streaming',
              'tool_calls',
              'vision',
              'audio_input',
              'audio_output',
              'embedding',
            ]),
          )
          .default(['text_generation']),
        contextWindow: z.number().int().positive().optional(),
        maxOutputTokens: z.number().int().positive().optional(),
      }),
    )
    .default([]),
  /** Display name (shown in UI picker) */
  displayName: z.string().optional(),
  /** Description */
  description: z.string().optional(),
  /** Signup URL */
  signupUrl: z.string().url().optional(),
  /** Vendor family for backward compat with existing config schema */
  vendorFamily: z.enum(['openai-compatible', 'anthropic', 'gemini']).optional(),
  /** Default headers to include on every request */
  defaultHeaders: z.record(z.string()).default({}),
  /** Fixed temperature — if set, ignore caller's temperature */
  fixedTemperature: z.number().min(0).max(2).optional(),
  /** Default max tokens */
  defaultMaxTokens: z.number().int().positive().optional(),
  /** Model for auxiliary tasks (compression, vision, etc.) */
  defaultAuxModel: z.string().optional(),
  /** Whether provider has a health-check endpoint (false = skip in doctor) */
  supportsHealthCheck: z.boolean().default(true),
});

export type ProviderProfileData = z.infer<typeof providerProfileSchema>;

// ── ProviderProfile class ─────────────────────────────────────────────────────

/**
 * Declarative provider profile.
 *
 * All provider-specific behavior is expressed as data + hooks, never as
 * if/else branches inside the adapter. The adapter calls profile.hooks()
 * and merges the results into the outgoing request.
 *
 * Subclass (or use ProviderProfile.create()) to add custom hooks.
 */
export class ProviderProfile {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly auth: {
    type: 'api_key' | 'oauth' | 'device_code' | 'aws_sdk';
    envVars: string[];
  };
  readonly aliases: readonly string[];
  readonly apiMode:
    | 'openai-compatible'
    | 'anthropic-messages'
    | 'gemini'
    | 'custom';
  readonly defaultModel?: string;
  readonly models: readonly {
    id: string;
    name?: string;
    capabilities: readonly string[];
    contextWindow?: number;
    maxOutputTokens?: number;
  }[];
  readonly displayName?: string;
  readonly description?: string;
  readonly signupUrl?: string;
  readonly vendorFamily?: 'openai-compatible' | 'anthropic' | 'gemini';
  readonly defaultHeaders: Record<string, string>;
  readonly fixedTemperature?: number;
  readonly defaultMaxTokens?: number;
  readonly defaultAuxModel?: string;
  readonly supportsHealthCheck: boolean;

  // Hooks — can be overridden per-subclass or passed to create()
  protected _buildRequestHooks: BuildRequestHook[] = [];
  protected _onStreamChunkHooks: OnStreamChunkHook[] = [];
  protected _prepareMessagesHooks: PrepareMessagesHook[] = [];

  constructor(data: ProviderProfileData) {
    const parsed = providerProfileSchema.parse(data);
    this.id = parsed.id;
    this.name = parsed.name;
    this.baseUrl = parsed.baseUrl ?? '';
    this.auth = parsed.auth ?? { type: 'api_key', envVars: [] };
    this.aliases = parsed.aliases;
    this.apiMode = parsed.apiMode;
    this.defaultModel = parsed.defaultModel;
    this.models = parsed.models;
    this.displayName = parsed.displayName;
    this.description = parsed.description;
    this.signupUrl = parsed.signupUrl;
    this.vendorFamily = parsed.vendorFamily;
    this.defaultHeaders = parsed.defaultHeaders;
    this.fixedTemperature = parsed.fixedTemperature;
    this.defaultMaxTokens = parsed.defaultMaxTokens;
    this.defaultAuxModel = parsed.defaultAuxModel;
    this.supportsHealthCheck = parsed.supportsHealthCheck;
  }

  static create(data: ProviderProfileData): ProviderProfile {
    return new ProviderProfile(data);
  }

  // ── Hook accessors ──────────────────────────────────────────────────────────

  /** Hooks called before sending a request — for building extra_body, headers, etc. */
  get buildRequestHooks(): readonly BuildRequestHook[] {
    return this._buildRequestHooks;
  }

  /** Hooks called on each streamed chunk — for extracting custom fields (reasoning, etc.) */
  get onStreamChunkHooks(): readonly OnStreamChunkHook[] {
    return this._onStreamChunkHooks;
  }

  /** Hooks called on messages before sending — for preprocessing */
  get prepareMessagesHooks(): readonly PrepareMessagesHook[] {
    return this._prepareMessagesHooks;
  }

  // ── Overridable hook methods ────────────────────────────────────────────────

  /**
   * Build extra fields to merge into the outgoing request body.
   * Return { extraBody, topLevel } — adapter merges these appropriately.
   *
   * Override in a subclass. Default: {}
   */
  buildExtraBody(context: HookContext): {
    extraBody: Record<string, unknown>;
    topLevel: Record<string, unknown>;
  } {
    return { extraBody: {}, topLevel: {} };
  }

  /**
   * Called on each streamed chunk. Return modified chunk fields.
   * Used by DeepSeek to accumulate `reasoning_content`.
   *
   * Override in a subclass. Default: returns chunk unchanged.
   */
  onStreamChunk(chunk: StreamChunk, context: HookContext): StreamChunk {
    return chunk;
  }

  /**
   * Preprocess messages before sending to the API.
   * Used to inject system instructions or transform roles.
   *
   * Override in a subclass. Default: pass-through.
   */
  prepareMessages(messages: unknown[]): unknown[] {
    return messages;
  }

  /**
   * Return per-model max tokens override.
   * Used by providers with per-model token caps.
   *
   * Override in a subclass. Default: undefined (use caller's or profile default).
   */
  getMaxTokens(model?: string): number | undefined {
    return undefined;
  }

  /**
   * Return the resolved base URL (can include runtime config overrides).
   * Default: returns this.baseUrl.
   */
  getBaseUrl(context?: HookContext): string {
    return this.baseUrl;
  }

  /**
   * Return the model ID to use when none specified.
   * Default: this.defaultModel.
   */
  resolveModel(modelHint?: string): string | undefined {
    return modelHint ?? this.defaultModel;
  }
}

// Re-export hook types
export type {
  BuildRequestHook,
  OnStreamChunkHook,
  PrepareMessagesHook,
  HookContext,
  StreamChunk,
} from './hooks';
```

**Step 3: Write the hooks file**

```typescript
// packages/providers/src/hooks.ts

/**
 * Hook signatures for ProviderProfile.
 *
 * Hooks are the mechanism by which provider-specific behavior is injected
 * into the adapter at runtime — without if/else chains inside the adapter.
 */

// ── Context passed to every hook ─────────────────────────────────────────────

export type HookContext = {
  model?: string;
  sessionId?: string;
  providerId: string;
  reasoningConfig?: {
    enabled?: boolean;
    effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  };
  extra?: Record<string, unknown>;
};

// ── BuildRequest hook ─────────────────────────────────────────────────────────

/**
 * Called before sending a request.
 *
 * Return extra fields to inject into the request:
 *   { extraBody, topLevel } — extraBody goes into `body.extra_body`,
 *   topLevel goes into the root request body (used for reasoning_effort etc.)
 *
 * DeepSeek uses this to inject:  extraBody: { thinking: { type: 'enabled' } }
 * OpenRouter uses this to inject: extraBody: { reasoning: { ... } }
 */
export type BuildRequestHook = (context: HookContext) => {
  extraBody?: Record<string, unknown>;
  topLevel?: Record<string, unknown>;
  headers?: Record<string, string>;
};

// ── Stream chunk hook ─────────────────────────────────────────────────────────

/**
 * A streamed chunk as it comes off the wire.
 */
export type StreamChunk = {
  /** The raw delta content (may be a string or object depending on provider) */
  delta: unknown;
  /** Role delta (for streaming role changes) */
  role?: string;
  /** Tool call delta */
  toolCall?: unknown;
  /** Reasoning content delta (DeepSeek, MiniMax, etc.) */
  reasoningContent?: string;
  /** Finish reason when present */
  finishReason?: string;
  /** Any other fields */
  [key: string]: unknown;
};

/**
 * Called on each streamed chunk.
 *
 * Providers like DeepSeek use this to accumulate `reasoning_content` delta
 * into a running string. The adapter calls this hook for every chunk and
 * accumulates returned `reasoningContent` into the running reasoning tracker.
 *
 * Return the (possibly modified) chunk fields. The adapter will merge
 * `reasoningContent` into the accumulated reasoning tracker if returned.
 */
export type OnStreamChunkHook = (
  chunk: StreamChunk,
  context: HookContext,
) => StreamChunk;

// ── PrepareMessages hook ──────────────────────────────────────────────────────

/**
 * Called on the messages array before sending.
 *
 * Providers can use this to:
 * - Inject a system prompt prefix (DeepSeek requires this for thinking mode)
 * - Transform message roles (some providers have role restrictions)
 * - Remove or redact content based on provider rules
 */
export type PrepareMessagesHook = (
  messages: unknown[],
  context: HookContext,
) => unknown[];
```

**Step 4: Verify types compile**

Run: `cd /tmp/openaidy/packages/providers && pnpm build`
Expected: no errors (dist/ types generated)

**Step 5: Run types test**

Run: `cd /tmp/openaidy/packages/providers && pnpm test -- types.test.ts`
Expected: 2 passed

---

## Task 3: Build `ProviderRegistry` with plugin discovery

**Objective:** Create the registry that auto-discovers profiles from `packages/providers/src/<name>/index.ts` using `pkgutil` (TypeScript port of Hermes's approach).

**Files:**

- Modify: `packages/providers/src/registry.ts` (create)

**Step 1: Write failing test**

```typescript
// packages/providers/src/registry.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { ProviderRegistry } from './registry';

describe('ProviderRegistry', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  it('should register and retrieve a profile by id', () => {
    registry.register({
      id: 'deepseek',
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
    });
    const profile = registry.get('deepseek');
    expect(profile?.id).toBe('deepseek');
  });

  it('should resolve aliases', () => {
    registry.register({
      id: 'deepseek',
      name: 'DeepSeek',
      aliases: ['deepseek-chat'],
    });
    expect(registry.get('deepseek-chat')?.id).toBe('deepseek');
  });

  it('should list all registered profiles', () => {
    registry.register({ id: 'deepseek', name: 'DeepSeek' });
    registry.register({ id: 'groq', name: 'Groq' });
    const all = registry.list();
    expect(all.map((p) => p.id)).toContain('deepseek');
    expect(all.map((p) => p.id)).toContain('groq');
  });

  it('should return undefined for unknown provider', () => {
    expect(registry.get('nonexistent')).toBeUndefined();
  });
});
```

Run: `cd /tmp/openaidy/packages/providers && pnpm test -- registry.test.ts`
Expected: FAIL — `registry.ts` not found

**Step 2: Write the registry**

```typescript
// packages/providers/src/registry.ts

import { ProviderProfile, type ProviderProfileData } from './types';

/**
 * Provider registry — discovers and registers ProviderProfile instances.
 *
 * Discovery: scans `packages/providers/src/<name>/index.ts` for each built-in
 * provider directory and imports them. Each profile file calls
 * `registry.register(profile)` at module level.
 *
 * User override: call registry.register(profile) with the same id to replace
 * a built-in profile. (Last-write-wins, same as Hermes.)
 */
export class ProviderRegistry {
  private _profiles = new Map<string, ProviderProfile>();
  private _aliases = new Map<string, string>();
  private _discovered = false;

  // ── Registration ─────────────────────────────────────────────────────────────

  /**
   * Register a profile by id and optional aliases.
   * Later registrations with the same id replace earlier ones.
   */
  register(profile: ProviderProfile | ProviderProfileData): void {
    const p =
      profile instanceof ProviderProfile
        ? profile
        : new ProviderProfile(profile);

    this._profiles.set(p.id, p);
    for (const alias of p.aliases) {
      this._aliases.set(alias, p.id);
    }
  }

  /**
   * Unregister a profile by id (for testing / hot-reload).
   */
  unregister(id: string): void {
    this._profiles.delete(id);
  }

  // ── Lookup ──────────────────────────────────────────────────────────────────

  /**
   * Get a profile by canonical id or alias.
   * Returns undefined if not registered.
   */
  get(nameOrAlias: string): ProviderProfile | undefined {
    if (!this._discovered) this._discover();
    const canonical = this._aliases.get(nameOrAlias) ?? nameOrAlias;
    return this._profiles.get(canonical);
  }

  /**
   * List all registered profiles (one per canonical id).
   */
  list(): readonly ProviderProfile[] {
    if (!this._discovered) this._discover();
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
   * Discover and import all built-in provider profiles.
   *
   * This scans the filesystem at runtime — not at build time — so new
   * providers can be added by dropping a directory, no rebuild needed.
   * (Implementation note: Node.js pkgutil is used in Hermes; here we use
   * a static list in _BUNDLED_PROVIDERS and a simple import map since we
   * are in TypeScript. In practice, the registry is populated at module
   * load time by importing each provider's index.ts.)
   *
   * The registry auto-imports all profiles from the built-in providers
   * directory using a static list. This avoids the need for dynamic
   * filesystem scanning at startup.
   */
  private _discover(): void {
    this._discovered = true;

    // Built-in providers — imported at startup
    // Each module calls registry.register(profile) at module level
    const builtInProviders = [
      'deepseek',
      'minimax',
      'groq',
      'openrouter',
    ] as const;

    for (const name of builtInProviders) {
      try {
        // Dynamic import — webpack and ts-node both handle this
        void import(`./${name}/index.js`);
      } catch {
        // Provider directory doesn't exist or has no index — skip
      }
    }
  }

  /**
   * Reset discovery state (for testing).
   */
  reset(): void {
    this._discovered = false;
    this._profiles.clear();
    this._aliases.clear();
  }
}

// ── Global registry instance ──────────────────────────────────────────────────

/**
 * The global provider registry.
 *
 * Provider profiles call `registry.register(profile)` at module level.
 * The adapter calls `registry.get('deepseek')` to resolve a profile at
 * request time.
 *
 * Note: This is a singleton. For testing, use `new ProviderRegistry()`.
 */
export const registry = new ProviderRegistry();
```

**Step 3: Run tests**

Run: `cd /tmp/openaidy/packages/providers && pnpm test -- registry.test.ts`
Expected: 4 passed

---

## Task 4: Create DeepSeek profile (moves DeepSeek branching out of adapter)

**Objective:** Replace `isDeepSeek = baseUrl.includes('deepseek.com')` branching in the adapter with a `DeepSeekProfile` that uses hook methods.

**Files:**

- Create: `packages/providers/src/deepseek/index.ts`
- Create: `packages/providers/src/deepseek/deepseek.test.ts`

**Step 1: Write failing test**

```typescript
// packages/providers/src/deepseek/deepseek.test.ts
import { describe, it, expect } from 'vitest';
import { DeepSeekProfile } from './index';
import type { HookContext } from '../hooks';

describe('DeepSeekProfile', () => {
  it('should identify deepseek base URLs', () => {
    const profile = new DeepSeekProfile();
    expect(profile.getBaseUrl()).toBe('https://api.deepseek.com');
  });

  it('should build extra_body with thinking enabled by default', () => {
    const profile = new DeepSeekProfile();
    const ctx: HookContext = {
      providerId: 'deepseek',
      model: 'deepseek-v4-flash',
    };
    const result = profile.buildExtraBody(ctx);
    expect(result.extraBody).toEqual({ thinking: { type: 'enabled' } });
  });

  it('should disable thinking when reasoning is disabled', () => {
    const profile = new DeepSeekProfile();
    const ctx: HookContext = {
      providerId: 'deepseek',
      model: 'deepseek-v4-flash',
      reasoningConfig: { enabled: false },
    };
    const result = profile.buildExtraBody(ctx);
    expect(result.extraBody).toEqual({ thinking: { type: 'disabled' } });
  });

  it('should map reasoning effort to reasoning_effort top-level', () => {
    const profile = new DeepSeekProfile();
    const ctx: HookContext = {
      providerId: 'deepseek',
      model: 'deepseek-v4-flash',
      reasoningConfig: { effort: 'high' },
    };
    const result = profile.buildExtraBody(ctx);
    expect(result.topLevel).toEqual({ reasoning_effort: 'high' });
  });

  it('should map xhigh/max to max', () => {
    const profile = new DeepSeekProfile();
    const ctx: HookContext = {
      providerId: 'deepseek',
      model: 'deepseek-v4-flash',
      reasoningConfig: { effort: 'max' },
    };
    const result = profile.buildExtraBody(ctx);
    expect(result.topLevel).toEqual({ reasoning_effort: 'max' });
  });

  it('should be a no-op for deepseek-chat (V3, no thinking)', () => {
    const profile = new DeepSeekProfile();
    const ctx: HookContext = { providerId: 'deepseek', model: 'deepseek-chat' };
    const result = profile.buildExtraBody(ctx);
    expect(result.extraBody).toEqual({});
    expect(result.topLevel).toEqual({});
  });

  it('should prepare messages with deepseek system instruction when thinking enabled', () => {
    const profile = new DeepSeekProfile();
    const ctx: HookContext = {
      providerId: 'deepseek',
      model: 'deepseek-v4-flash',
      reasoningConfig: { enabled: true },
    };
    const messages = [{ role: 'user', content: 'hello' }];
    const prepared = profile.prepareMessages(messages as never[]);
    // Should inject a system message requiring reasoning
    expect(prepared).toHaveLength(2);
    expect((prepared as never[])[0]).toMatchObject({ role: 'system' });
  });

  it('should not inject system message when thinking is disabled', () => {
    const profile = new DeepSeekProfile();
    const ctx: HookContext = {
      providerId: 'deepseek',
      model: 'deepseek-v4-flash',
      reasoningConfig: { enabled: false },
    };
    const messages = [{ role: 'user', content: 'hello' }];
    const prepared = profile.prepareMessages(messages as never[]);
    expect(prepared).toHaveLength(1);
  });

  it('should accumulate reasoning_content from stream chunks', () => {
    const profile = new DeepSeekProfile();
    const ctx: HookContext = {
      providerId: 'deepseek',
      model: 'deepseek-v4-flash',
    };
    const chunk1 = profile.onStreamChunk(
      { delta: 'let me think', reasoningContent: undefined },
      ctx,
    );
    const chunk2 = profile.onStreamChunk(
      { delta: 'more reasoning', reasoningContent: undefined },
      ctx,
    );
    // The hook should return reasoningContent to accumulate
    expect(chunk1.reasoningContent).toBeDefined();
    expect(chunk2.reasoningContent).toBeDefined();
  });
});
```

Run: `cd /tmp/openaidy/packages/providers && pnpm test -- deepseek/deepseek.test.ts`
Expected: FAIL — `index.ts` doesn't exist

**Step 2: Write the DeepSeek profile**

```typescript
// packages/providers/src/deepseek/index.ts

import { ProviderProfile, type HookContext, type StreamChunk } from '../index';
import { registry } from '../registry';

/**
 * DeepSeek provider profile.
 *
 * DeepSeek V4 family (deepseek-v4-pro, deepseek-v4-flash) and legacy
 * deepseek-reasoner (R1) default to thinking-mode ON. The API requires
 * `extra_body.thinking.type` to be explicitly set, otherwise it returns
 * reasoning_content and enforces that subsequent turns echo it back —
 * causing the notorious HTTP 400 "reasoning_content must be passed back"
 * error after the first tool call.
 *
 * This profile:
 * - Sets extra_body.thinking.type = 'enabled' | 'disabled'
 * - Maps reasoning_effort to the top-level reasoning_effort param
 * - Injects a system message enabling reasoning when thinking is on
 * - Accumulates reasoning_content from stream chunks
 */

function _modelSupportsThinking(model: string | undefined): boolean {
  const m = (model ?? '').trim().toLowerCase();
  if (!m) return false;
  // V4+ (but not V3): deepseek-v4-*, deepseek-v5-*, etc.
  if (m.startsWith('deepseek-v') && !m.startsWith('deepseek-v3')) return true;
  // Legacy reasoner
  if (m === 'deepseek-reasoner') return true;
  return false;
}

export class DeepSeekProfile extends ProviderProfile {
  constructor() {
    super({
      id: 'deepseek',
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      apiMode: 'openai-compatible',
      vendorFamily: 'openai-compatible',
      displayName: 'DeepSeek',
      description: 'DeepSeek — native DeepSeek API',
      signupUrl: 'https://platform.deepseek.com/',
      models: [
        {
          id: 'deepseek-v4-pro',
          name: 'DeepSeek V4 Pro',
          capabilities: ['text_generation', 'streaming', 'tool_calls'],
        },
        {
          id: 'deepseek-v4-flash',
          name: 'DeepSeek V4 Flash',
          capabilities: ['text_generation', 'streaming', 'tool_calls'],
        },
        {
          id: 'deepseek-chat',
          name: 'DeepSeek Chat (V3)',
          capabilities: ['text_generation', 'streaming', 'tool_calls'],
        },
      ],
      defaultModel: 'deepseek-v4-flash',
      defaultAuxModel: 'deepseek-chat',
      aliases: ['deepseek-chat'],
      auth: { type: 'api_key', envVars: ['DEEPSEEK_API_KEY'] },
      supportsHealthCheck: true,
    });
  }

  override buildExtraBody(context: HookContext): {
    extraBody: Record<string, unknown>;
    topLevel: Record<string, unknown>;
  } {
    const extraBody: Record<string, unknown> = {};
    const topLevel: Record<string, unknown> = {};

    if (!_modelSupportsThinking(context.model)) {
      // V3 or unknown — leave wire format untouched
      return { extraBody, topLevel };
    }

    const enabled = context.reasoningConfig?.enabled !== false;
    extraBody['thinking'] = { type: enabled ? 'enabled' : 'disabled' };

    if (!enabled) return { extraBody, topLevel };

    // Map reasoning effort
    const effort = (context.reasoningConfig?.effort ?? '').trim().toLowerCase();
    if (effort === 'xhigh' || effort === 'max') {
      topLevel['reasoning_effort'] = 'max';
    } else if (['low', 'medium', 'high'].includes(effort)) {
      topLevel['reasoning_effort'] = effort;
    }
    // Omitting reasoning_effort when not set → DeepSeek applies server default (high)

    return { extraBody, topLevel };
  }

  override prepareMessages(messages: unknown[]): unknown[] {
    const thinkingEnabled = this._isThinkingEnabled();
    if (!thinkingEnabled) return messages;

    // DeepSeek requires a system message instructing the model to use reasoning
    const systemMsg = {
      role: 'system',
      content:
        'You are a helpful assistant. When appropriate, use deep thinking to reason through problems step by step.',
    };

    // Inject system message at the beginning
    return [systemMsg, ...(messages as unknown[])];
  }

  override onStreamChunk(
    chunk: StreamChunk,
    _context: HookContext,
  ): StreamChunk {
    // Extract reasoning_content from the chunk's delta
    const delta = chunk.delta as { reasoning_content?: string } | undefined;
    if (delta?.reasoning_content) {
      return { ...chunk, reasoningContent: delta.reasoning_content };
    }
    return chunk;
  }

  private _isThinkingEnabled(): boolean {
    // Check via the reasoning config stored on the profile
    // (set by buildExtraBody — this is called after it in the adapter flow)
    return true; // Default to enabled; caller must disable explicitly
  }
}

// Register with the global registry
registry.register(new DeepSeekProfile());
```

**Step 3: Run tests**

Run: `cd /tmp/openaidy/packages/providers && pnpm test -- deepseek/deepseek.test.ts`
Expected: All 9 tests pass

---

## Task 5: Create MiniMax, Groq, and OpenRouter profiles

**Files:**

- Create: `packages/providers/src/minimax/index.ts`
- Create: `packages/providers/src/minimax/minimax.test.ts`
- Create: `packages/providers/src/groq/index.ts`
- Create: `packages/providers/src/groq/groq.test.ts`
- Create: `packages/providers/src/openrouter/index.ts`
- Create: `packages/providers/src/openrouter/openrouter.test.ts`

**Step 1: Write MiniMax profile** (copy pattern from deepseek)

MiniMax has two variants — international (`api.minimax.io`) and China (`api.minimaxi.com`). Both use OpenAI-compatible endpoints.

Key quirks:

- MiniMax supports thinking blocks (like DeepSeek) — `` tags
- Uses `anthropic_messages` API mode (baseUrl ends in `/anthropic`)
- `reasoning_content` delta in streaming

```typescript
// packages/providers/src/minimax/index.ts
// ... (similar structure to DeepSeek, with minimax-specific getBaseUrl handling)
```

**Step 2: Write Groq profile**

Groq is simpler — it's a pure OpenAI-compatible provider with fast inference.

- baseUrl: `https://api.groq.com/openai/v1`
- No thinking mode
- No special hooks needed — just register as openai-compatible with correct baseUrl

**Step 3: Write OpenRouter profile**

OpenRouter aggregates 200+ models. Key quirks:

- Supports `extra_body.provider` for provider preferences
- Supports `extra_body.reasoning` for reasoning config passthrough
- Has a live model catalog at `https://openrouter.ai/api/v1/models`
- `x-grok-conv-id` header for xAI Grok models (pinned conversation context)

```typescript
// packages/providers/src/openrouter/index.ts
// ... extends ProviderProfile, overrides buildExtraBody for provider prefs
// ... overrides fetch_models to hit the OpenRouter models endpoint
```

**Step 4: Write tests for each**

Run: `cd /tmp/openaidy/packages/providers && pnpm test`
Expected: All provider profile tests pass

---

## Task 6: Wire profiles into the OpenAI-compatible adapter (remove `isDeepSeek` branching)

**Objective:** Replace `if (baseUrl.includes('deepseek.com'))` in the adapter with a call to `registry.get(providerId)?.buildExtraBody()` and `registry.get(providerId)?.onStreamChunk()`.

**Files:**

- Modify: `apps/server/src/providers/infrastructure/openai-compatible/adapter.ts`
- Modify: `apps/server/src/providers/infrastructure/openai-compatible/types.ts`

**Step 1: Read current adapter branching** (do this before starting)

The adapter currently has `isDeepSeek` checks at lines ~318, 444, 492, 524:

```typescript
const isDeepSeek = this.config.baseUrl.includes('deepseek.com');
// → reasoning_content accumulation in streaming
// → system message prepending
// → extra_body.thinking injection
```

Replace each with a profile hook call.

**Step 2: Add registry import to adapter**

```typescript
import { registry } from '@openaidy/providers/registry';
```

**Step 3: Replace isDeepSeek branching**

Find each `isDeepSeek` usage and replace with:

```typescript
// Before:
const isDeepSeek = this.config.baseUrl.includes('deepseek.com');

// After:
const profile = registry.get(this.config.providerId ?? PROVIDER_ID);
const isDeepSeek = profile?.getBaseUrl().includes('deepseek.com') ?? false;
```

Then replace each branching block:

1. **Streaming reasoning_content accumulation** (line ~318):

```typescript
// Replace:
if (isDeepSeek && choice.delta?.reasoning_content) { ... }

// With:
const chunk = profile?.onStreamChunk(
  { delta: choice.delta },
  { model: modelId, providerId: this.config.providerId ?? PROVIDER_ID }
);
if (chunk?.reasoningContent) {
  reasoningContent += chunk.reasoningContent;
}
```

2. **System message prepending** (line ~444):

```typescript
// Replace:
if (isDeepSeek && !messages.some(m => m.role === 'system' && ...)) {
  messages = [{ role: 'system', content: '...' }, ...messages];
}

// With:
const preparedMessages = profile?.prepareMessages(messages) ?? messages;
```

3. **Extra body thinking injection** (line ~492):

```typescript
// Replace:
if (isDeepSeek) {
  requestParams.extra_body = { thinking: { type: 'enabled' } };
}

// With:
const { extraBody, topLevel } = profile?.buildExtraBody({
  model: modelId,
  providerId: this.config.providerId ?? PROVIDER_ID,
  reasoningConfig: context.reasoningConfig,
}) ?? { extraBody: {}, topLevel: {} };
if (Object.keys(extraBody).length > 0) {
  requestParams.extra_body = { ...requestParams.extra_body, ...extraBody };
}
// Merge topLevel into requestParams as well
```

**Step 4: Add tests for profile wiring**

```typescript
// apps/server/src/providers/infrastructure/openai-compatible/adapter-profile.test.ts
// Tests that the adapter calls profile hooks correctly for DeepSeek/minimax
```

Run: `pnpm --filter @openaidy/server test -- adapter-profile.test.ts`
Expected: All pass

---

## Task 7: Update provider config layer to use profiles (backward compat)

**Objective:** Make `appProviderConfigSchema` and the config service work with profiles — not as a replacement, but so profiles can be derived from config and vice versa.

**Files:**

- Modify: `packages/config/src/provider/base.ts` (add profileFromConfig)
- Modify: `packages/config/src/provider/openai-compatible.ts` (add createCompatibleProfile)
- Modify: `apps/server/src/providers/config-service.ts` (wire registry)

**Step 1: Add `profileFromConfig` helper**

```typescript
// packages/config/src/provider/base.ts

import { ProviderProfile } from '@openaidy/providers/types';

/**
 * Convert an appProviderConfig (the config file shape) into a ProviderProfile.
 * This lets users configure providers in openaidy.yaml and get profile hooks.
 */
export function profileFromConfig(config: AppProviderConfig): ProviderProfile {
  return ProviderProfile.create({
    id: config.id,
    name: config.name,
    baseUrl: config.baseUrl,
    apiMode:
      config.vendorFamily === 'anthropic'
        ? 'anthropic-messages'
        : config.vendorFamily === 'gemini'
          ? 'gemini'
          : 'openai-compatible',
    vendorFamily: config.vendorFamily,
    defaultModel: config.defaultModel,
    models: config.models.map((m) => ({
      id: m.id,
      name: m.name,
      capabilities: m.capabilities ?? ['text_generation'],
      contextWindow: m.contextWindow,
      maxOutputTokens: m.maxOutputTokens,
    })),
    auth: {
      type: 'api_key',
      envVars: config.apiKeyEnv ? [config.apiKeyEnv] : [],
    },
    defaultMaxTokens: config.defaultMaxTokens,
    defaultTemperature: config.defaultTemperature,
  });
}
```

**Step 2: Wire registry into config-service**

```typescript
// apps/server/src/providers/config-service.ts

import { registry } from '@openaidy/providers/registry';
import { profileFromConfig } from '@openaidy/config/provider/base';

export class ProviderConfigService {
  // ...

  /** Get a ProviderProfile for a provider id — registry profile takes precedence */
  getProfile(providerId: string): ProviderProfile | undefined {
    // 1. Check built-in registry profile (deepseek, minimax, etc.)
    const regProfile = registry.get(providerId);
    if (regProfile) return regProfile;

    // 2. Fall back to deriving from config
    const config = this.getProviderConfig(providerId);
    if (config) return profileFromConfig(config);

    return undefined;
  }
}
```

---

## Task 8: Add provider presets to providers package

**Objective:** Migrate `providers-preset.ts` from `shared-types` to `providers` package, and make it use `ProviderProfile` instances instead of plain objects.

**Files:**

- Create: `packages/providers/src/presets.ts`
- Modify: `packages/shared-types/src/providers-preset.ts` (re-export from providers)
- Create: `packages/providers/src/deepseek/index.ts` etc. (already done in Task 4-5)

**Step 1: Write presets file**

```typescript
// packages/providers/src/presets.ts

import { ProviderProfile } from './types';
import { registry } from './registry';

/**
 * Pre-configured provider presets.
 *
 * These are ProviderProfile instances for popular providers that users can
 * select when setting up a new provider. They mirror the ProviderPreset
 * concept from shared-types but as full profiles with hooks.
 *
 * Usage:
 *   const deepseekPreset = PRESETS.find(p => p.id === 'deepseek');
 *   registry.register(deepseekPreset);
 */
export const PRESETS: ProviderProfile[] = [
  // DeepSeek — registered via profile module, this is the static preset list
  // MiniMax
  // Groq
  // OpenRouter
  // (OpenAI, Anthropic, Google are their own vendor families with own adapters)
];

export function getPreset(id: string): ProviderProfile | undefined {
  return PRESETS.find((p) => p.id === id);
}
```

**Step 2: Update shared-types re-export**

```typescript
// packages/shared-types/src/providers-preset.ts
// Add: export type { ProviderProfile } from '@openaidy/providers';
// Keep the existing ProviderPreset type but have it derive from providers
```

---

## Task 9: Update config schema documentation

**Objective:** Document that `vendorFamily` now maps to profile `apiMode`, and that adding a new provider means either:

1. Adding a profile to `packages/providers/src/<name>/` (for built-in providers)
2. Using the config directly (for one-off / private providers)

**Files:**

- Modify: `docs/providers.md` (create if not exists)
- Check: `apps/web/src/config/schemas/providers-schema.ts` — verify it still works with the new profile layer (it reads from config, not from profiles, so no changes needed)

---

## Task 10: Final integration test

**Objective:** Verify the full stack works — config loaded → profile resolved → adapter calls hooks → correct request sent.

**Files:**

- Create: `packages/providers/src/integration.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { registry } from './registry';
import { profileFromConfig } from '@openaidy/config/src/provider/base';

describe('Provider profile integration', () => {
  it('should resolve deepseek profile from registry', () => {
    const profile = registry.get('deepseek');
    expect(profile?.id).toBe('deepseek');
    expect(profile?.getBaseUrl()).toBe('https://api.deepseek.com');
  });

  it('should derive profile from app config and get same hooks', () => {
    const config = {
      id: 'my-deepseek',
      name: 'My DeepSeek',
      vendorFamily: 'openai-compatible' as const,
      baseUrl: 'https://api.deepseek.com',
      models: [
        {
          id: 'deepseek-v4-flash',
          name: 'DeepSeek V4 Flash',
          capabilities: ['text_generation', 'streaming', 'tool_calls'],
        },
      ],
      defaultModel: 'deepseek-v4-flash',
    };
    const profile = profileFromConfig(config);
    expect(profile.id).toBe('my-deepseek');
    expect(profile.defaultModel).toBe('deepseek-v4-flash');
  });

  it('deepseek profile should produce correct extra_body for thinking model', () => {
    const profile = registry.get('deepseek')!;
    const result = profile.buildExtraBody({
      providerId: 'deepseek',
      model: 'deepseek-v4-flash',
      reasoningConfig: { enabled: true, effort: 'high' },
    });
    expect(result.extraBody).toEqual({ thinking: { type: 'enabled' } });
    expect(result.topLevel).toEqual({ reasoning_effort: 'high' });
  });

  it('deepseek profile should be no-op for non-thinking model', () => {
    const profile = registry.get('deepseek')!;
    const result = profile.buildExtraBody({
      providerId: 'deepseek',
      model: 'deepseek-chat',
    });
    expect(result.extraBody).toEqual({});
  });
});
```

Run: `cd /tmp/openaidy/packages/providers && pnpm test`
Expected: All tests pass (registry + all provider profiles + integration)

---

## Verification Commands

```bash
# Build the providers package
cd /tmp/openaidy/packages/providers && pnpm build

# Run providers tests
cd /tmp/openaidy/packages/providers && pnpm test

# Run server tests (should still pass with adapter wired to profiles)
cd /tmp/openaidy && pnpm --filter @openaidy/server test -- adapter-profile.test.ts

# Run full test suite (all packages)
cd /tmp/openaidy && pnpm test
```

Expected: All tests pass, no regressions in existing functionality.

---

## Summary of Changes by File

| File                                                                    | Action | Purpose                                           |
| ----------------------------------------------------------------------- | ------ | ------------------------------------------------- |
| `packages/providers/package.json`                                       | Create | New package                                       |
| `packages/providers/tsconfig.json`                                      | Create | Build config                                      |
| `packages/providers/src/types.ts`                                       | Create | `ProviderProfile` dataclass + schema              |
| `packages/providers/src/hooks.ts`                                       | Create | Hook signature types                              |
| `packages/providers/src/registry.ts`                                    | Create | `ProviderRegistry` + global singleton             |
| `packages/providers/src/deepseek/index.ts`                              | Create | DeepSeek profile with thinking hooks              |
| `packages/providers/src/minimax/index.ts`                               | Create | MiniMax profile                                   |
| `packages/providers/src/groq/index.ts`                                  | Create | Groq profile                                      |
| `packages/providers/src/openrouter/index.ts`                            | Create | OpenRouter profile with provider prefs            |
| `apps/server/src/providers/infrastructure/openai-compatible/adapter.ts` | Modify | Remove `isDeepSeek` branching, call profile hooks |
| `packages/config/src/provider/base.ts`                                  | Modify | Add `profileFromConfig()` helper                  |
| `apps/server/src/providers/config-service.ts`                           | Modify | Wire registry into config service                 |
| `packages/shared-types/src/providers-preset.ts`                         | Modify | Re-export from providers package                  |
| `docs/providers.md`                                                     | Create | Documentation                                     |

---

## Commit Strategy

```
Commit 1: chore(providers): add package scaffold
Commit 2: feat(providers): add ProviderProfile types and hooks
Commit 3: feat(providers): add ProviderRegistry with plugin discovery
Commit 4: feat(providers): add DeepSeekProfile with thinking hooks
Commit 5: feat(providers): add MiniMax, Groq, OpenRouter profiles
Commit 6: refactor(server): wire profiles into OpenAI adapter, remove isDeepSeek branching
Commit 7: feat(config): add profileFromConfig helper
Commit 8: test(providers): add integration tests
Commit 9: chore: update providers-preset.ts to re-export from providers
```
