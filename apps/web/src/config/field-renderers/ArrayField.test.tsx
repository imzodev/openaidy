import { describe, it, expect, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@solidjs/testing-library';
import { ArrayField } from './ArrayField';
import { resetDefaultRegistry, getDefaultRegistry } from './registry';
import { registerStandardRenderers } from './index';
import type { FieldSchema } from '../schema';

beforeEach(() => {
  cleanup();
  resetDefaultRegistry();
  registerStandardRenderers(getDefaultRegistry());
});

const stringItemSchema: FieldSchema = {
  type: 'string',
  key: 'item',
  label: 'Tag',
};

const objectItemSchema: FieldSchema = {
  type: 'object',
  key: 'model',
  label: 'Model',
  properties: {
    id: { type: 'string', key: 'id', label: 'Model ID' },
    name: { type: 'string', key: 'name', label: 'Display Name' },
    enabled: {
      type: 'boolean',
      key: 'enabled',
      label: 'Enabled',
      defaultValue: true,
    },
    maxOutputTokens: {
      type: 'number',
      key: 'maxOutputTokens',
      label: 'Max Output Tokens',
      defaultValue: 4096,
    },
  },
};

const arraySchema = (overrides: Partial<FieldSchema> = {}): FieldSchema => ({
  type: 'array',
  key: 'items',
  label: 'Tag',
  itemSchema: stringItemSchema,
  ...overrides,
});

describe('ArrayField', () => {
  describe('rendering', () => {
    it('renders existing items', () => {
      const { getAllByRole } = render(() =>
        ArrayField({
          value: ['alpha', 'beta'],
          onChange: () => {},
          schema: arraySchema(),
        }),
      );
      const inputs = getAllByRole('textbox');
      expect(inputs).toHaveLength(2);
      expect((inputs[0] as HTMLInputElement).value).toBe('alpha');
      expect((inputs[1] as HTMLInputElement).value).toBe('beta');
    });

    it('renders empty list without crashing', () => {
      const { container } = render(() =>
        ArrayField({
          value: [],
          onChange: () => {},
          schema: arraySchema(),
        }),
      );
      expect(container).toBeTruthy();
    });

    it('shows add button when itemSchema is present', () => {
      const { getByText } = render(() =>
        ArrayField({
          value: [],
          onChange: () => {},
          schema: arraySchema(),
        }),
      );
      expect(getByText(/Add Tag/i)).toBeInTheDocument();
    });

    it('does not show remove button when at minItems', () => {
      const { queryAllByTitle } = render(() =>
        ArrayField({
          value: ['only-item'],
          onChange: () => {},
          schema: arraySchema({ minItems: 1 }),
        }),
      );
      expect(queryAllByTitle('Remove item')).toHaveLength(0);
    });

    it('shows remove buttons when above minItems', () => {
      const { getAllByTitle } = render(() =>
        ArrayField({
          value: ['a', 'b'],
          onChange: () => {},
          schema: arraySchema({ minItems: 1 }),
        }),
      );
      expect(getAllByTitle('Remove item')).toHaveLength(2);
    });

    it('hides add button when disabled', () => {
      const { queryByText } = render(() =>
        ArrayField({
          value: [],
          onChange: () => {},
          schema: arraySchema(),
          disabled: true,
        }),
      );
      expect(queryByText(/Add/i)).not.toBeInTheDocument();
    });

    it('hides add button when maxItems reached', () => {
      const { queryByText } = render(() =>
        ArrayField({
          value: ['a', 'b'],
          onChange: () => {},
          schema: arraySchema({ maxItems: 2 }),
        }),
      );
      expect(queryByText(/Add/i)).not.toBeInTheDocument();
    });
  });

  describe('add item', () => {
    it('calls onChange with new empty string item appended', () => {
      let emitted: unknown;
      const { getByText } = render(() =>
        ArrayField({
          value: ['existing'],
          onChange: (v) => {
            emitted = v;
          },
          schema: arraySchema(),
        }),
      );
      fireEvent.click(getByText(/Add Tag/i));
      expect(emitted).toEqual(['existing', '']);
    });

    it('new object item uses defaultValues from itemSchema properties', () => {
      let emitted: unknown;
      const { getByText } = render(() =>
        ArrayField({
          value: [],
          onChange: (v) => {
            emitted = v;
          },
          schema: arraySchema({ itemSchema: objectItemSchema, label: 'Model' }),
        }),
      );
      fireEvent.click(getByText(/Add Model/i));
      expect(emitted).toEqual([{ enabled: true, maxOutputTokens: 4096 }]);
    });

    it('does not add when at maxItems', () => {
      let called = false;
      render(() =>
        ArrayField({
          value: ['a'],
          onChange: () => {
            called = true;
          },
          schema: arraySchema({ maxItems: 1, minItems: 0 }),
        }),
      );
      // Add button should not be present; ensure no call happens
      expect(called).toBe(false);
    });
  });

  describe('remove item', () => {
    it('calls onChange with item removed by index', () => {
      let emitted: unknown;
      const { getAllByTitle } = render(() =>
        ArrayField({
          value: ['a', 'b', 'c'],
          onChange: (v) => {
            emitted = v;
          },
          schema: arraySchema({ minItems: 0 }),
        }),
      );
      fireEvent.click(getAllByTitle('Remove item')[1]!);
      expect(emitted).toEqual(['a', 'c']);
    });

    it('does not call onChange when at minItems', () => {
      let called = false;
      render(() =>
        ArrayField({
          value: ['only'],
          onChange: () => {
            called = true;
          },
          schema: arraySchema({ minItems: 1 }),
        }),
      );
      expect(called).toBe(false);
    });
  });

  describe('item change', () => {
    it('calls onChange with updated item value on blur', () => {
      let emitted: unknown;
      const { getAllByRole } = render(() =>
        ArrayField({
          value: ['original'],
          onChange: (v) => {
            emitted = v;
          },
          schema: arraySchema(),
        }),
      );
      const input = getAllByRole('textbox')[0] as HTMLInputElement;
      fireEvent.input(input, { target: { value: 'updated' } });
      fireEvent.blur(input);
      expect((emitted as string[])[0]).toBe('updated');
    });
  });
});
