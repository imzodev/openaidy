/**
 * openaidy-sdk.js is a plain browser IIFE (uses window/document/localStorage
 * at load time), so it can't be executed directly in this project's node
 * test environment — the same constraint component-manifest.test.ts works
 * around by reading it as text. These tests do the same: extract the
 * theme-sync pieces from source and assert on them statically.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ADDON_THEME_TOKEN_NAMES } from '@openaidy/shared-types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SDK_PATH = path.join(__dirname, 'openaidy-sdk.js');
const source = readFileSync(SDK_PATH, 'utf-8');

function extractFallbackThemeTokens(): Record<string, string> {
  const match = source.match(
    /var FALLBACK_THEME_TOKENS = (\{[\s\S]*?\n\s*\});/,
  );
  if (!match) {
    throw new Error('FALLBACK_THEME_TOKENS literal not found in source');
  }
  // The literal uses single-quoted keys/values, which is valid JS but not
  // valid JSON — evaluate it as JS rather than JSON.parse it.
   
  return new Function(`return (${match[1]});`)();
}

describe('openaidy-sdk.js theme sync', () => {
  it('keeps FALLBACK_THEME_TOKENS in sync with ADDON_THEME_TOKEN_NAMES', () => {
    const fallbackKeys = Object.keys(extractFallbackThemeTokens()).sort();
    const hostKeys = [...ADDON_THEME_TOKEN_NAMES].sort();
    // Regression guard: if the host adds/removes a theme token in
    // packages/shared-types without updating this fallback, this fails
    // loudly instead of the SDK silently dropping or misapplying it.
    expect(fallbackKeys).toEqual(hostKeys);
  });

  it('drives _applyTheme from the union of fallback and host-sent keys, not the fallback alone', () => {
    expect(source).toContain(
      'Object.keys(Object.assign({}, FALLBACK_THEME_TOKENS, tokens))',
    );
  });

  it('probes for the host theme instead of hardcoding dark for the initial paint', () => {
    expect(source).not.toMatch(
      /_applyTheme\(\{ mode: 'dark', tokens: FALLBACK_THEME_TOKENS \}\);/,
    );
    expect(source).toContain('_initialMode');
    expect(source).toContain("localStorage.getItem('theme')");
    expect(source).toContain('prefers-color-scheme: dark');
  });

  it('validates event.source on incoming messages before acting on them', () => {
    expect(source).toContain('if (event.source !== window.parent) return;');
  });
});
