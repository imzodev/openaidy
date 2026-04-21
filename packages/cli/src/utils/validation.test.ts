/**
 * Validation Utilities Tests
 */

import { describe, it, expect } from 'vitest';
import {
  validateAddonId,
  validateAddonName,
  validateVersion,
  validateTemplateName,
  validateEmail,
  validateUrl,
  validateManifest,
  validateProjectPath,
} from './validation.js';

describe('Validation Utilities', () => {
  describe('validateAddonId', () => {
    it('should accept valid addon IDs', () => {
      expect(validateAddonId('my-addon')).toBe(true);
      expect(validateAddonId('price-analyzer')).toBe(true);
      expect(validateAddonId('a')).toBe(false);
      expect(validateAddonId('my_addon')).toBe(false);
      expect(validateAddonId('MyAddon')).toBe(false);
    });

    it('should reject IDs that are too short or too long', () => {
      expect(validateAddonId('a')).toBe(false);
      expect(validateAddonId('ab')).toBe(true);
      expect(validateAddonId('a'.repeat(51))).toBe(false);
      expect(validateAddonId('a'.repeat(50))).toBe(true);
    });

    it('should reject IDs with uppercase or special characters', () => {
      expect(validateAddonId('MyAddon')).toBe(false);
      expect(validateAddonId('my_addon')).toBe(false);
      expect(validateAddonId('my.addon')).toBe(false);
      expect(validateAddonId('my addon')).toBe(false);
    });
  });

  describe('validateAddonName', () => {
    it('should accept valid addon names', () => {
      expect(validateAddonName('My Addon')).toBe(true);
      expect(validateAddonName('Price Analyzer')).toBe(true);
      expect(validateAddonName('addon-123')).toBe(true);
    });

    it('should reject names that are too short or too long', () => {
      expect(validateAddonName('A')).toBe(false);
      expect(validateAddonName('AB')).toBe(true);
      expect(validateAddonName('A'.repeat(101))).toBe(false);
    });

    it('should reject names with special characters', () => {
      expect(validateAddonName('My@Addon')).toBe(false);
      expect(validateAddonName('My#Addon')).toBe(false);
      expect(validateAddonName('My$Addon')).toBe(false);
    });
  });

  describe('validateVersion', () => {
    it('should accept valid semantic versions', () => {
      expect(validateVersion('1.0.0')).toBe(true);
      expect(validateVersion('0.1.0')).toBe(true);
      expect(validateVersion('10.20.30')).toBe(true);
      expect(validateVersion('1.0.0-alpha')).toBe(true);
      expect(validateVersion('1.0.0-alpha.1')).toBe(true);
    });

    it('should reject invalid versions', () => {
      expect(validateVersion('1.0')).toBe(false);
      expect(validateVersion('1')).toBe(false);
      expect(validateVersion('1.0.0.0')).toBe(false);
      expect(validateVersion('v1.0.0')).toBe(false);
      expect(validateVersion('1.0')).toBe(false);
    });
  });

  describe('validateTemplateName', () => {
    it('should accept valid template names', () => {
      expect(validateTemplateName('basic')).toBe(true);
      expect(validateTemplateName('agent')).toBe(true);
      expect(validateTemplateName('multi-page')).toBe(true);
      expect(validateTemplateName('config')).toBe(true);
    });

    it('should reject invalid template names', () => {
      expect(validateTemplateName('custom')).toBe(false);
      expect(validateTemplateName('advanced')).toBe(false);
      expect(validateTemplateName('')).toBe(false);
    });
  });

  describe('validateEmail', () => {
    it('should accept valid email addresses', () => {
      expect(validateEmail('test@example.com')).toBe(true);
      expect(validateEmail('user.name@domain.org')).toBe(true);
    });

    it('should reject invalid email addresses', () => {
      expect(validateEmail('invalid')).toBe(false);
      expect(validateEmail('invalid@')).toBe(false);
      expect(validateEmail('@domain.com')).toBe(false);
    });
  });

  describe('validateUrl', () => {
    it('should accept valid URLs', () => {
      expect(validateUrl('https://example.com')).toBe(true);
      expect(validateUrl('http://localhost:3000')).toBe(true);
    });

    it('should reject invalid URLs', () => {
      expect(validateUrl('not-a-url')).toBe(false);
      expect(validateUrl('')).toBe(false);
    });
  });

  describe('validateManifest', () => {
    it('should validate a complete manifest', () => {
      const manifest = {
        id: 'my-addon',
        name: 'My Addon',
        version: '1.0.0',
        description: 'A test addon',
        openaidy: {
          minVersion: '1.0.0',
        },
      };
      const result = validateManifest(manifest);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing required fields', () => {
      const manifest = {
        name: 'My Addon',
      };
      const result = validateManifest(manifest);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should detect invalid version format', () => {
      const manifest = {
        id: 'my-addon',
        name: 'My Addon',
        version: 'invalid',
        description: 'Test',
        openaidy: {},
      };
      const result = validateManifest(manifest);
      expect(result.valid).toBe(false);
    });

    it('should warn about missing openaidy.minVersion', () => {
      const manifest = {
        id: 'my-addon',
        name: 'My Addon',
        version: '1.0.0',
        description: 'Test',
        openaidy: {},
      };
      const result = validateManifest(manifest);
      expect(result.warnings.some((w) => w.includes('minVersion'))).toBe(true);
    });
  });

  describe('validateProjectPath', () => {
    it('should accept valid project paths', () => {
      const result = validateProjectPath('/path/to/project');
      expect(result.valid).toBe(true);
    });

    it('should reject empty paths', () => {
      const result = validateProjectPath('');
      expect(result.valid).toBe(false);
    });

    it('should reject paths with directory traversal', () => {
      const result = validateProjectPath('../parent');
      expect(result.valid).toBe(false);
    });
  });
});
