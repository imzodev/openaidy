/**
 * @openaidy/providers
 *
 * Public surface — re-export everything from sub-modules.
 */

// Types
export {
  ProviderProfile,
  providerProfileSchema,
  type ProviderProfileData,
} from './types';

// Hooks (shared across packages — no logic here)
export type {
  HookContext,
  StreamChunk,
  BuildRequestHook,
  OnStreamChunkHook,
  PrepareMessagesHook,
} from './hooks';

// Registry
export { ProviderRegistry, registry } from './registry';

// Built-in provider profiles — re-exported so callers can extend or
// instantiate them directly (e.g. for tests or custom add-ons).
export { AnthropicProfile } from './anthropic/index';
export { DeepSeekProfile } from './deepseek/index';
export { GoogleProfile } from './google/index';
export { GroqProfile } from './groq/index';
export { MiniMaxProfile } from './minimax/index';
export { OpenAIProfile } from './openai/index';
export { OpenRouterProfile } from './openrouter/index';
export { OpenCodeGoProfile } from './opencode-go/index';
export { OpenCodeGoAnthropicProfile } from './opencode-go-anthropic/index';
export { OpenCodeZenProfile } from './opencode-zen/index';
