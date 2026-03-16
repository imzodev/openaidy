// Types
export * from './types';

// Registry service
export {
  ProviderRegistryService,
  createProviderRegistry,
} from './registry';

// Selection service
export {
  ProviderSelectionService,
  createProviderSelection,
} from './selection';

// Invocation service
export {
  ModelInvocationService,
  createModelInvocation,
} from './invocation';

// Integrated invocation
export {
  IntegratedInvocationService,
  createIntegratedInvocation,
  type IntegratedInvocationOptions,
  type IntegratedLoadResult,
  type IntegratedInvokeResult,
  type SelectionWithConfigResult,
} from './integrated-invocation';

// Unified service container
import { ProviderRegistryService, createProviderRegistry } from './registry';
import { ProviderSelectionService, createProviderSelection } from './selection';
import { ModelInvocationService, createModelInvocation } from './invocation';

/**
 * Container for all provider-related services
 * 
 * This ensures a single instance of each service per application,
 * preventing architectural drift from multiple isolated registries.
 */
export type ProviderServices = {
  readonly registry: ProviderRegistryService;
  readonly selection: ProviderSelectionService;
  readonly invocation: ModelInvocationService;
};

/**
 * Create a unified set of provider services
 * 
 * This factory creates all provider services with proper dependencies:
 * - Registry is created first (no dependencies)
 * - Selection depends on registry
 * - Invocation depends on both registry and selection
 * 
 * All services share the same underlying registry instance.
 */
export function createProviderServices(): ProviderServices {
  const registry = createProviderRegistry();
  const selection = createProviderSelection(registry);
  const invocation = createModelInvocation(registry, selection);

  return {
    registry,
    selection,
    invocation,
  };
}
