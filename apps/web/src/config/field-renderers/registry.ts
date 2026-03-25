/**
 * Field renderer registry
 *
 * Implements the registry pattern for field renderers,
 * allowing new field types to be added without modifying
 * the core form logic (Open/Closed Principle).
 */

import type { FieldType } from '../schema';
import type { FieldRenderer } from './types';

/**
 * Registry for field renderers
 *
 * Maps field types to their renderer functions.
 * New field types can be added by registering new renderers.
 */
export type FieldRendererRegistry = {
  /** Register a renderer for a field type */
  register: (type: FieldType, renderer: FieldRenderer) => void;
  /** Get the renderer for a field type */
  get: (type: FieldType) => FieldRenderer | undefined;
  /** Check if a renderer exists for a field type */
  has: (type: FieldType) => boolean;
  /** Get all registered field types */
  getTypes: () => FieldType[];
};

/**
 * Create a new field renderer registry
 *
 * @returns A new registry instance
 */
export function createFieldRendererRegistry(): FieldRendererRegistry {
  const renderers = new Map<FieldType, FieldRenderer>();

  return {
    register(type, renderer) {
      renderers.set(type, renderer);
    },

    get(type) {
      return renderers.get(type);
    },

    has(type) {
      return renderers.has(type);
    },

    getTypes() {
      return Array.from(renderers.keys());
    },
  };
}

/**
 * Global default registry instance
 *
 * This is used by the DynamicConfigForm if no custom registry is provided.
 */
let defaultRegistry: FieldRendererRegistry | null = null;

/**
 * Get the default field renderer registry
 *
 * Creates the registry on first access and populates it
 * with the standard field renderers.
 *
 * @returns The default registry instance
 */
export function getDefaultRegistry(): FieldRendererRegistry {
  if (!defaultRegistry) {
    defaultRegistry = createFieldRendererRegistry();
    // Note: Standard renderers are registered in ./index.ts
    // to avoid circular dependencies
  }
  return defaultRegistry;
}

/**
 * Reset the default registry (useful for testing)
 */
export function resetDefaultRegistry(): void {
  defaultRegistry = null;
}
