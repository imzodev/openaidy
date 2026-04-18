import { describe, it, expect } from 'vitest';
import { getProvidersSectionSchema } from './providers-schema';
import type { FieldSchema } from '../schema';

describe('getProvidersSectionSchema', () => {
  const schema = getProvidersSectionSchema();
  const providerArrayField = schema.fields[0]!;
  const providerItemSchema = providerArrayField.itemSchema!;
  const properties = providerItemSchema.properties!;

  it('section id is providers', () => {
    expect(schema.id).toBe('providers');
  });

  it('top-level field is an array keyed providers', () => {
    expect(providerArrayField.type).toBe('array');
    expect(providerArrayField.key).toBe('providers');
  });

  describe('models field', () => {
    const modelsField = properties['models']!;

    it('exists in provider item properties', () => {
      expect(modelsField).toBeDefined();
    });

    it('is an array type', () => {
      expect(modelsField.type).toBe('array');
    });

    it('has minItems of 1', () => {
      expect(modelsField.minItems).toBe(1);
    });

    it('has an itemSchema of type object', () => {
      expect(modelsField.itemSchema?.type).toBe('object');
    });

    describe('model item fields', () => {
      const modelProps = modelsField.itemSchema!.properties!;

      const requiredFields: [string, FieldSchema['type']][] = [
        ['id', 'string'],
        ['name', 'string'],
        ['enabled', 'boolean'],
        ['contextWindow', 'number'],
        ['maxOutputTokens', 'number'],
      ];

      for (const [key, type] of requiredFields) {
        it(`has a ${key} field of type ${type}`, () => {
          expect(modelProps[key]).toBeDefined();
          expect(modelProps[key]!.type).toBe(type);
        });
      }

      it('enabled defaults to true', () => {
        expect(modelProps['enabled']!.defaultValue).toBe(true);
      });

      it('id is required', () => {
        expect(modelProps['id']!.required).toBe(true);
      });

      it('name is required', () => {
        expect(modelProps['name']!.required).toBe(true);
      });
    });
  });

  describe('common provider fields still present', () => {
    it('has id field', () => {
      expect(properties['id']).toBeDefined();
    });

    it('has vendorFamily select field', () => {
      expect(properties['vendorFamily']?.type).toBe('select');
    });

    it('has defaultModel field', () => {
      expect(properties['defaultModel']).toBeDefined();
    });
  });
});
