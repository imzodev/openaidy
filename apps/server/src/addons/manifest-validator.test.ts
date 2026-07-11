import { describe, it, expect, beforeEach } from 'vitest';
import {
  ManifestValidator,
  createManifestValidator,
  validateAddonManifest,
} from './manifest-validator.js';
import { AddonManifestSchema, ValidationError } from '@openaidy/shared-types';

describe('ManifestValidator', () => {
  let validator: ManifestValidator;

  const validManifest = {
    id: 'price-analyzer',
    name: 'Price Analyzer',
    version: '1.0.0',
    description: 'Analyze prices across multiple sources',
    openaidy: {
      minVersion: '0.1.0',
      maxVersion: '2.0.0',
    },
    entry: 'dist/index.js',
    permissions: ['sessions.read', 'agents.invoke:price-analyzer'],
  };

  beforeEach(() => {
    validator = createManifestValidator({ openAidyVersion: '1.0.0' });
  });

  describe('validateSchema', () => {
    it('should accept a valid manifest', () => {
      const result = validator.validateSchema(validManifest);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.manifest).toBeDefined();
        expect(result.manifest.id).toBe('price-analyzer');
      }
    });

    it('should reject manifest missing required fields', () => {
      const result = validator.validateSchema({ name: 'Test' });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.length).toBeGreaterThan(0);
      }
    });

    it('should reject invalid addon ID', () => {
      const result = validator.validateSchema({
        ...validManifest,
        id: 'Invalid-ID',
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(
          result.errors.some((e: ValidationError) => e.field.includes('id')),
        ).toBe(true);
      }
    });

    it('should reject invalid semver version', () => {
      const result = validator.validateSchema({
        ...validManifest,
        version: '1.0',
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(
          result.errors.some((e: ValidationError) =>
            e.field.includes('version'),
          ),
        ).toBe(true);
      }
    });

    it('should reject invalid openaidy version format', () => {
      const result = validator.validateSchema({
        ...validManifest,
        openaidy: { minVersion: 'invalid' },
      });
      expect(result.valid).toBe(false);
    });

    it('should reject empty permissions array with invalid format', () => {
      const result = validator.validateSchema({
        ...validManifest,
        permissions: ['invalid-permission'],
      });
      expect(result.valid).toBe(false);
    });

    it('should accept valid permissions', () => {
      const result = validator.validateSchema({
        ...validManifest,
        permissions: [
          'sessions.read',
          'config.write:pricing',
          'agents.invoke:test',
        ],
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('validate with existing IDs', () => {
    it('should reject duplicate addon ID', () => {
      const result = validator.validate(validManifest, ['price-analyzer']);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(
          result.errors.some((e: ValidationError) => e.code === 'DUPLICATE_ID'),
        ).toBe(true);
      }
    });

    it('should reject reserved addon ID', () => {
      const result = validator.validate({ ...validManifest, id: 'system' }, []);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(
          result.errors.some((e: ValidationError) => e.code === 'RESERVED_ID'),
        ).toBe(true);
      }
    });
  });

  describe('version compatibility', () => {
    it('should reject when minVersion is higher than current', () => {
      const result = validator.validate(
        { ...validManifest, openaidy: { minVersion: '2.0.0' } },
        [],
      );
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(
          result.errors.some(
            (e: ValidationError) => e.code === 'INCOMPATIBLE_VERSION',
          ),
        ).toBe(true);
      }
    });

    it('should reject when maxVersion is lower than current', () => {
      const result = validator.validate(
        {
          ...validManifest,
          openaidy: { minVersion: '0.1.0', maxVersion: '0.5.0' },
        },
        [],
      );
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(
          result.errors.some(
            (e: ValidationError) => e.code === 'INCOMPATIBLE_VERSION',
          ),
        ).toBe(true);
      }
    });

    it('should reject when minVersion > maxVersion', () => {
      const result = validator.validate(
        {
          ...validManifest,
          openaidy: { minVersion: '2.0.0', maxVersion: '1.0.0' },
        },
        [],
      );
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(
          result.errors.some(
            (e: ValidationError) => e.code === 'INVALID_VERSION_RANGE',
          ),
        ).toBe(true);
      }
    });
  });

  describe('UI validation', () => {
    it('should reject duplicate route paths', () => {
      const result = validator.validate({
        ...validManifest,
        ui: {
          routes: [
            { path: '/test', component: 'Test' },
            { path: '/test', component: 'Test2' },
          ],
        },
      });
      expect(result.valid).toBe(false);
    });

    it('should reject route paths with path traversal', () => {
      const result = validator.validate({
        ...validManifest,
        ui: {
          routes: [{ path: '/test/../admin', component: 'Admin' }],
        },
      });
      expect(result.valid).toBe(false);
    });

    it('should reject invalid sidebar order', () => {
      const result = validator.validate({
        ...validManifest,
        ui: {
          sidebar: { icon: 'test', label: 'Test', order: 1001 },
        },
      });
      expect(result.valid).toBe(false);
    });
  });

  describe('entry validation', () => {
    it('should reject entry with path traversal', () => {
      const result = validator.validate({
        ...validManifest,
        entry: '../dist/index.js',
      });
      expect(result.valid).toBe(false);
    });

    it('should reject dangerous entry extensions', () => {
      const result = validator.validate({
        ...validManifest,
        entry: 'script.sh',
      });
      expect(result.valid).toBe(false);
    });
  });

  describe('quick validation function', () => {
    it('should work with validateAddonManifest', () => {
      const result = validateAddonManifest(validManifest, [], '1.0.0');
      expect(result.valid).toBe(true);
    });
  });

  describe('validateWithIssues', () => {
    it('should return warnings for missing optional fields', () => {
      const minimalManifest = {
        id: 'test-addon',
        name: 'Test',
        version: '1.0.0',
        openaidy: { minVersion: '0.1.0' },
        entry: 'dist/index.js',
        permissions: [],
      };

      const { issues } = validator.validateWithIssues(minimalManifest);
      expect(issues.warnings.length).toBeGreaterThan(0);
    });
  });
});

describe('AddonManifestSchema', () => {
  it('should parse complete manifest', () => {
    const manifest = {
      id: 'test-addon',
      name: 'Test Addon',
      version: '1.0.0',
      description: 'A test addon',
      openaidy: { minVersion: '1.0.0' },
      entry: 'dist/index.js',
      permissions: ['sessions.read'],
      author: {
        name: 'Test Author',
        email: 'test@example.com',
      },
    };

    const result = AddonManifestSchema.safeParse(manifest);
    expect(result.success).toBe(true);
  });

  it('should apply defaults', () => {
    const manifest = {
      id: 'test-addon',
      name: 'Test',
      version: '1.0.0',
      openaidy: { minVersion: '1.0.0' },
      entry: 'dist/index.js',
      permissions: [],
    };

    const result = AddonManifestSchema.safeParse(manifest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.license).toBe('MIT');
      expect(result.data.$schema).toBe(
        'https://openaidy.dev/schemas/addon-v1.json',
      );
    }
  });

  describe('storage validation', () => {
    const v = createManifestValidator({ openAidyVersion: '1.0.0' });
    const base = {
      id: 'store-addon',
      name: 'Store',
      version: '1.0.0',
      description: 'x',
      openaidy: { minVersion: '0.1.0' },
      entry: 'app/index.html',
      permissions: [] as string[],
    };
    const withQueries = (
      agentQueries: Array<{ name: string; sql: string }>,
    ) => ({
      ...base,
      storage: {
        agentQueries: agentQueries.map((q) => ({
          ...q,
          description: 'q',
          access: 'read' as const,
        })),
      },
    });

    it('rejects duplicate agent query names', () => {
      const result = v.validate(
        withQueries([
          { name: 'dup', sql: 'SELECT 1' },
          { name: 'dup', sql: 'SELECT 2' },
        ]),
        [],
      );
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(
          result.errors.some(
            (e: ValidationError) => e.code === 'DUPLICATE_QUERY_NAME',
          ),
        ).toBe(true);
      }
    });

    it('accepts unique agent query names', () => {
      const result = v.validate(
        withQueries([
          { name: 'a', sql: 'SELECT 1' },
          { name: 'b', sql: 'SELECT 2' },
        ]),
        [],
      );
      expect(result.valid).toBe(true);
    });
  });
});
