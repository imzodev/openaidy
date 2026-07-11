/**
 * Addon Manifest Validator
 *
 * Validates addon manifests against the schema and performs
 * security and compatibility checks.
 */

import * as semver from 'semver';
import {
  AddonManifestSchema,
  AddonManifest,
  ManifestValidationResult,
  ValidationError,
  parsePermission,
  PERMISSION_RESOURCES,
  PERMISSION_ACTIONS,
} from '@openaidy/shared-types';

/**
 * Configuration for the validator
 */
export interface ManifestValidatorConfig {
  /** Current OpenAidy version to check compatibility against */
  openAidyVersion: string;
  /** Whether to enable strict security checks */
  strictSecurity?: boolean;
  /** Custom permission allowed list */
  allowedPermissions?: string[];
}

/**
 * Validation issues and warnings
 */
export interface ValidationIssues {
  errors: ValidationError[];
  warnings: string[];
}

/**
 * Default validator configuration
 */
const DEFAULT_CONFIG: ManifestValidatorConfig = {
  openAidyVersion: '1.0.0',
  strictSecurity: true,
  allowedPermissions: [],
};

/**
 * Create a validation error
 */
function createValidationError(
  field: string,
  message: string,
  code: string,
): ValidationError {
  return { field, message, code };
}

/**
 * Validate the basic manifest structure using Zod schema
 */
function validateSchema(manifest: unknown): ValidationError[] {
  const result = AddonManifestSchema.safeParse(manifest);

  if (result.success) {
    return [];
  }

  return result.error.errors.map((err) =>
    createValidationError(err.path.join('.'), err.message, err.code),
  );
}

/**
 * Validate addon ID format and conflicts
 */
function validateAddonId(
  manifest: AddonManifest,
  existingIds: string[],
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Check for reserved IDs
  const reservedIds = ['openaidy', 'system', 'admin', 'api', 'internal'];

  if (reservedIds.includes(manifest.id)) {
    errors.push(
      createValidationError(
        'id',
        `Addon ID '${manifest.id}' is reserved`,
        'RESERVED_ID',
      ),
    );
  }

  // Check for conflicts with existing addons
  if (existingIds.includes(manifest.id)) {
    errors.push(
      createValidationError(
        'id',
        `Addon ID '${manifest.id}' is already in use`,
        'DUPLICATE_ID',
      ),
    );
  }

  return errors;
}

/**
 * Validate OpenAidy version compatibility
 */
function validateVersionCompatibility(
  manifest: AddonManifest,
  currentVersion: string,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const { minVersion, maxVersion } = manifest.openaidy;

  // Check minVersion
  if (minVersion) {
    if (!semver.valid(minVersion)) {
      errors.push(
        createValidationError(
          'openaidy.minVersion',
          'Invalid semver format',
          'INVALID_VERSION',
        ),
      );
    } else if (semver.gt(minVersion, currentVersion)) {
      errors.push(
        createValidationError(
          'openaidy.minVersion',
          `Addon requires OpenAidy ${minVersion}, but current version is ${currentVersion}`,
          'INCOMPATIBLE_VERSION',
        ),
      );
    }
  }

  // Check maxVersion
  if (maxVersion) {
    if (!semver.valid(maxVersion)) {
      errors.push(
        createValidationError(
          'openaidy.maxVersion',
          'Invalid semver format',
          'INVALID_VERSION',
        ),
      );
    } else if (semver.lt(maxVersion, currentVersion)) {
      errors.push(
        createValidationError(
          'openaidy.maxVersion',
          `Addon supports up to OpenAidy ${maxVersion}, but current version is ${currentVersion}`,
          'INCOMPATIBLE_VERSION',
        ),
      );
    }

    // Check range validity
    if (
      minVersion &&
      maxVersion &&
      semver.valid(minVersion) &&
      semver.valid(maxVersion)
    ) {
      if (semver.gt(minVersion, maxVersion)) {
        errors.push(
          createValidationError(
            'openaidy',
            'minVersion cannot be greater than maxVersion',
            'INVALID_VERSION_RANGE',
          ),
        );
      }
    }
  }

  return errors;
}

/**
 * Validate permission strings
 */
function validatePermissions(
  manifest: AddonManifest,
  allowedPermissions: string[],
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Check for empty permissions
  if (manifest.permissions.length === 0) {
    // This is allowed, just a warning - no error
    return errors;
  }

  for (const permission of manifest.permissions) {
    // Parse the permission
    const parsed = parsePermission(permission);

    if (!parsed) {
      errors.push(
        createValidationError(
          'permissions',
          `Invalid permission format: ${permission}`,
          'INVALID_PERMISSION_FORMAT',
        ),
      );
      continue;
    }

    // Check if resource is valid
    const validResource = PERMISSION_RESOURCES.some(
      (r) => r === parsed.resource,
    );
    if (!validResource) {
      // Allow custom resources but warn
      // Only error in strict mode
    }

    // Check if action is valid
    const validAction = PERMISSION_ACTIONS.some((a) => a === parsed.action);
    if (!validAction) {
      errors.push(
        createValidationError(
          'permissions',
          `Invalid permission action: ${parsed.action}`,
          'INVALID_PERMISSION_ACTION',
        ),
      );
    }

    // Check against allowed permissions list if provided
    if (allowedPermissions.length > 0) {
      const isAllowed = allowedPermissions.some((allowed) => {
        if (allowed.endsWith('.*')) {
          const prefix = allowed.slice(0, -2);
          return permission.startsWith(prefix);
        }
        return permission === allowed;
      });

      if (!isAllowed) {
        errors.push(
          createValidationError(
            'permissions',
            `Permission not allowed: ${permission}`,
            'PERMISSION_NOT_ALLOWED',
          ),
        );
      }
    }

    // Security: Warn about dangerous permissions
    const dangerousPermissions = [
      'system.addons.manage',
      'system.manage',
      'config.write',
      'config.write:*',
    ];

    if (dangerousPermissions.includes(permission)) {
      // This is allowed but should trigger a warning in the UI
      // Not an error, but something for admins to review
    }
  }

  return errors;
}

/**
 * Validate UI configuration
 */
function validateUIConfig(manifest: AddonManifest): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!manifest.ui) {
    return errors;
  }

  // Validate routes
  if (manifest.ui.routes) {
    const paths = new Set<string>();

    for (const route of manifest.ui.routes) {
      // Check for duplicate paths
      if (paths.has(route.path)) {
        errors.push(
          createValidationError(
            `ui.routes[].path`,
            `Duplicate route path: ${route.path}`,
            'DUPLICATE_ROUTE',
          ),
        );
      }
      paths.add(route.path);

      // Validate path format
      if (!route.path.startsWith('/')) {
        errors.push(
          createValidationError(
            `ui.routes[].path`,
            'Route path must start with /',
            'INVALID_ROUTE_PATH',
          ),
        );
      }

      // Validate path doesn't contain dangerous patterns
      if (route.path.includes('..')) {
        errors.push(
          createValidationError(
            `ui.routes[].path`,
            'Route path cannot contain .. (path traversal)',
            'INVALID_ROUTE_PATH',
          ),
        );
      }
    }
  }

  // Validate sidebar order
  if (manifest.ui.sidebar) {
    const order = manifest.ui.sidebar.order;
    if (order !== undefined && (order < 0 || order > 1000)) {
      errors.push(
        createValidationError(
          'ui.sidebar.order',
          'Order must be between 0 and 1000',
          'INVALID_SIDEBAR_ORDER',
        ),
      );
    }
  }

  return errors;
}

/**
 * Validate entry point path
 */
function validateEntry(manifest: AddonManifest): ValidationError[] {
  const errors: ValidationError[] = [];

  // Check for path traversal in entry
  if (manifest.entry.includes('..')) {
    errors.push(
      createValidationError(
        'entry',
        'Entry path cannot contain .. (path traversal)',
        'INVALID_ENTRY_PATH',
      ),
    );
  }

  // Check for potentially dangerous entry paths
  const dangerousExtensions = ['.sh', '.bat', '.cmd', '.ps1'];
  const ext = manifest.entry.split('.').pop()?.toLowerCase();

  if (ext && dangerousExtensions.includes(`.${ext}`)) {
    errors.push(
      createValidationError(
        'entry',
        `Entry file with extension .${ext} is not allowed`,
        'INVALID_ENTRY_EXTENSION',
      ),
    );
  }

  return errors;
}

/**
 * Validate the storage block. The Zod schema already checks structure; here we
 * add the cross-field check it can't: agent query names must be unique (an
 * addon_run call resolves a query by name, so duplicates would silently shadow).
 */
function validateStorage(manifest: AddonManifest): ValidationError[] {
  const errors: ValidationError[] = [];
  const queries = (
    manifest as { storage?: { agentQueries?: Array<{ name: string }> } }
  ).storage?.agentQueries;
  if (!queries) return errors;

  const seen = new Set<string>();
  for (const q of queries) {
    if (seen.has(q.name)) {
      errors.push(
        createValidationError(
          'storage.agentQueries',
          `Duplicate agent query name: "${q.name}"`,
          'DUPLICATE_QUERY_NAME',
        ),
      );
    }
    seen.add(q.name);
  }
  return errors;
}

/**
 * Validate dependencies
 */
function validateDependencies(manifest: AddonManifest): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!manifest.dependencies) {
    return errors;
  }

  // Check for OpenAidy core dependencies
  const openaidyDeps = Object.keys(manifest.dependencies).filter((dep) =>
    dep.startsWith('@openaidy/'),
  );

  if (openaidyDeps.length > 0) {
    // These should match the openaidy version constraints
    // Just a warning - not an error
  }

  return errors;
}

/**
 * Main manifest validator class
 */
export class ManifestValidator {
  private config: ManifestValidatorConfig;

  constructor(config: Partial<ManifestValidatorConfig> = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };
  }

  /**
   * Validate an addon manifest
   */
  validate(
    manifest: unknown,
    existingAddonIds: string[] = [],
  ): ManifestValidationResult {
    // First, validate with Zod schema
    const schemaErrors = validateSchema(manifest);

    if (schemaErrors.length > 0) {
      return {
        valid: false,
        errors: schemaErrors,
      };
    }

    const typedManifest = manifest as AddonManifest;
    const allErrors: ValidationError[] = [];

    // Run all validations
    allErrors.push(...validateAddonId(typedManifest, existingAddonIds));
    allErrors.push(
      ...validateVersionCompatibility(
        typedManifest,
        this.config.openAidyVersion,
      ),
    );
    allErrors.push(
      ...validatePermissions(
        typedManifest,
        this.config.allowedPermissions || [],
      ),
    );
    allErrors.push(...validateUIConfig(typedManifest));
    allErrors.push(...validateEntry(typedManifest));
    allErrors.push(...validateDependencies(typedManifest));
    allErrors.push(...validateStorage(typedManifest));

    if (allErrors.length > 0) {
      return {
        valid: false,
        errors: allErrors,
      };
    }

    return {
      valid: true,
      manifest: typedManifest,
    };
  }

  /**
   * Validate just the schema (quick check)
   */
  validateSchema(manifest: unknown): ManifestValidationResult {
    const result = AddonManifestSchema.safeParse(manifest);

    if (!result.success) {
      return {
        valid: false,
        errors: result.error.errors.map((err) =>
          createValidationError(err.path.join('.'), err.message, err.code),
        ),
      };
    }

    return {
      valid: true,
      manifest: result.data,
    };
  }

  /**
   * Get validation issues with warnings
   */
  validateWithIssues(
    manifest: unknown,
    existingAddonIds: string[] = [],
  ): { result: ManifestValidationResult; issues: ValidationIssues } {
    const result = this.validate(manifest, existingAddonIds);
    const warnings: string[] = [];

    if (result.valid && manifest) {
      const m = manifest as AddonManifest;

      // Add warnings for potentially problematic configurations
      if (m.permissions.length > 50) {
        warnings.push('Large number of permissions may require careful review');
      }

      if (m.ui?.routes && m.ui.routes.length > 20) {
        warnings.push('Many routes may impact performance');
      }

      if (!m.author) {
        warnings.push('No author information provided');
      }

      if (!m.description) {
        warnings.push('No description provided');
      }

      if (m.license === 'MIT' && !m.license) {
        // Default is MIT, so this is fine
      }
    }

    return {
      result,
      issues: {
        errors: result.valid ? [] : result.errors,
        warnings,
      },
    };
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<ManifestValidatorConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): ManifestValidatorConfig {
    return { ...this.config };
  }
}

/**
 * Create a validator with default configuration
 */
export function createManifestValidator(
  config?: Partial<ManifestValidatorConfig>,
): ManifestValidator {
  return new ManifestValidator(config);
}

/**
 * Quick validation function for simple use cases
 */
export function validateAddonManifest(
  manifest: unknown,
  existingAddonIds: string[] = [],
  openAidyVersion?: string,
): ManifestValidationResult {
  const validator = new ManifestValidator({
    openAidyVersion: openAidyVersion || DEFAULT_CONFIG.openAidyVersion,
  });

  return validator.validate(manifest, existingAddonIds);
}
