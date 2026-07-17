import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseComponentManifest } from './component-manifest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SDK_PATH = path.join(__dirname, '../sdk/openaidy-sdk.js');

describe('parseComponentManifest', () => {
  it('parses a single @component block with required and optional params', () => {
    const source = `
      var sdk = {
        ui: {
          /**
           * @component
           * @namespace sdk.ui
           * @description A simple test component.
           * @param {string} title - Required title
           * @param {string} [subtitle] - Optional subtitle
           * @returns {HTMLElement}
           */
          card: function (opts) { return document.createElement('div'); },
        },
      };
    `;
    const manifest = parseComponentManifest(source);
    expect(manifest.components).toHaveLength(1);
    const entry = manifest.components[0]!;
    expect(entry.name).toBe('card');
    expect(entry.namespace).toBe('sdk.ui');
    expect(entry.description).toBe('A simple test component.');
    expect(entry.returns).toBe('HTMLElement');
    expect(entry.params).toEqual([
      {
        name: 'title',
        type: 'string',
        required: true,
        description: 'Required title',
      },
      {
        name: 'subtitle',
        type: 'string',
        required: false,
        description: 'Optional subtitle',
      },
    ]);
  });

  it('ignores JSDoc blocks without an @component tag', () => {
    const source = `
      var sdk = {
        /** Read a JSON value by key (resolves undefined if absent). */
        get: function (key) { return null; },
      };
    `;
    const manifest = parseComponentManifest(source);
    expect(manifest.components).toHaveLength(0);
  });

  it('defaults version to 1.0.0 and accepts an override', () => {
    expect(parseComponentManifest('').version).toBe('1.0.0');
    expect(parseComponentManifest('', '2.0.0').version).toBe('2.0.0');
  });

  it('defaults returns to "void" when @returns is absent', () => {
    const source = `
      /**
       * @component
       * @namespace sdk.ui
       * @description No explicit return type.
       */
      widget: function () {},
    `;
    const manifest = parseComponentManifest(source);
    expect(manifest.components[0]!.returns).toBe('void');
  });

  it('parses a union type like {HTMLElement|string} verbatim', () => {
    const source = `
      /**
       * @component
       * @namespace sdk.ui
       * @description Has a union-typed param.
       * @param {HTMLElement|string} [children] - Content
       * @returns {HTMLElement}
       */
      card: function () {},
    `;
    const manifest = parseComponentManifest(source);
    expect(manifest.components[0]!.params[0]).toEqual({
      name: 'children',
      type: 'HTMLElement|string',
      required: false,
      description: 'Content',
    });
  });

  it('parses every sdk.ui.* component in the real openaidy-sdk.js', () => {
    const source = readFileSync(SDK_PATH, 'utf-8');
    const manifest = parseComponentManifest(source);
    expect(manifest.components).toHaveLength(25);
    for (const entry of manifest.components) {
      expect(entry.namespace).toBe('sdk.ui');
      expect(entry.description.length).toBeGreaterThan(0);
      expect(entry.returns).toBe('HTMLElement');
    }
    const names = manifest.components.map((c) => c.name);
    expect(names).toContain('card');
    expect(names).toContain('dialog');
    expect(names).toContain('popover');
  });
});
