/**
 * Tests for the Gemini function-name sanitization helpers.
 *
 * The Gemini `generateContent` API rejects function names containing
 * "more than one colon" (e.g. `github::create_or_update_file`, which
 * is the convention MCP servers use to namespace their tools). The
 * helpers in `name-mapping.ts` substitute `::` with `:` for the
 * request side and reverse-lookup the original name on the
 * response side.
 */

import { describe, it, expect } from 'vitest';
import {
  sanitizeGeminiFunctionName,
  buildGeminiFunctionNameMap,
  restoreGeminiFunctionName,
} from './name-mapping';

describe('sanitizeGeminiFunctionName', () => {
  it('replaces `::` with `:` (single colon, API-valid)', () => {
    expect(sanitizeGeminiFunctionName('github::create_or_update_file')).toBe(
      'github:create_or_update_file',
    );
  });

  it('replaces every `::` in a name', () => {
    expect(sanitizeGeminiFunctionName('a::b::c')).toBe('a:b:c');
  });

  it('leaves names without `::` unchanged', () => {
    expect(sanitizeGeminiFunctionName('get_weather')).toBe('get_weather');
  });

  it('leaves names with a single `:` unchanged (already API-valid)', () => {
    expect(sanitizeGeminiFunctionName('ns:tool')).toBe('ns:tool');
  });

  it('handles empty string', () => {
    expect(sanitizeGeminiFunctionName('')).toBe('');
  });
});

describe('buildGeminiFunctionNameMap', () => {
  it('returns an empty map when no sanitization is needed', () => {
    const map = buildGeminiFunctionNameMap(['get_weather', 'send_email']);
    expect(map.size).toBe(0);
  });

  it('builds a sanitized -> original map for MCP-style names', () => {
    const map = buildGeminiFunctionNameMap([
      'github::create_or_update_file',
      'get_weather',
      'gitlab::merge_request',
    ]);

    expect(map.size).toBe(2);
    expect(map.get('github:create_or_update_file')).toBe(
      'github::create_or_update_file',
    );
    expect(map.get('gitlab:merge_request')).toBe('gitlab::merge_request');
    // Non-MCP names don't appear in the map (no reverse needed).
    expect(map.has('get_weather')).toBe(false);
  });
});

describe('restoreGeminiFunctionName', () => {
  const map = buildGeminiFunctionNameMap([
    'github::create_or_update_file',
    'get_weather',
  ]);

  it('restores the original name for sanitized inputs', () => {
    expect(restoreGeminiFunctionName('github:create_or_update_file', map)).toBe(
      'github::create_or_update_file',
    );
  });

  it('passes through names not in the map (no MCP-style sanitization needed)', () => {
    expect(restoreGeminiFunctionName('get_weather', map)).toBe('get_weather');
  });

  it('returns the input unchanged when the map is empty', () => {
    expect(
      restoreGeminiFunctionName('github:create_or_update_file', new Map()),
    ).toBe('github:create_or_update_file');
  });

  it('returns the input unchanged for empty string', () => {
    expect(restoreGeminiFunctionName('', map)).toBe('');
  });
});

describe('round trip: name -> sanitize -> map -> restore', () => {
  it('preserves the original name through the full request/response cycle', () => {
    const original = 'github::create_or_update_file';
    const sanitized = sanitizeGeminiFunctionName(original);
    expect(sanitized).toBe('github:create_or_update_file');

    const map = buildGeminiFunctionNameMap([original]);
    const restored = restoreGeminiFunctionName(sanitized, map);
    expect(restored).toBe(original);
  });
});
