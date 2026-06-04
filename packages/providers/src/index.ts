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
