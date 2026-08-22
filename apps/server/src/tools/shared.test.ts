import { describe, it, expect } from 'vitest';
import {
  formatToolError,
  optionalString,
  requireService,
  requireString,
} from './shared';

describe('requireService', () => {
  it('returns the service when the getter resolves it', () => {
    const svc = { id: 'svc' };
    const result = requireService(() => svc, 'Task service');
    expect(result).toEqual({ ok: true, service: svc });
  });

  it('returns a uniform failure when the getter returns undefined', () => {
    const result = requireService(() => undefined, 'Task service');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe(
      'Task service is not available (database might be disabled).',
    );
  });
});

describe('requireString', () => {
  it('returns null for a non-empty string', () => {
    expect(requireString('hello', 'description')).toBeNull();
  });

  it('rejects an empty string', () => {
    const err = requireString('', 'description');
    expect(err).toMatch(/required/);
    expect(err).toMatch(/description/);
  });

  it('rejects a whitespace-only string', () => {
    const err = requireString('   ', 'description');
    expect(err).toMatch(/required/);
  });

  it('rejects non-string values', () => {
    expect(requireString(42, 'description')).toMatch(/required/);
    expect(requireString(null, 'description')).toMatch(/required/);
    expect(requireString(undefined, 'description')).toMatch(/required/);
    expect(requireString({}, 'description')).toMatch(/required/);
  });
});

describe('optionalString', () => {
  it('returns null when the value is undefined', () => {
    expect(optionalString(undefined, 'title')).toBeNull();
  });

  it('returns null when the value is null', () => {
    expect(optionalString(null, 'title')).toBeNull();
  });

  it('returns null for a non-empty string', () => {
    expect(optionalString('hello', 'title')).toBeNull();
  });

  it('rejects an empty provided string', () => {
    const err = optionalString('', 'title');
    expect(err).toMatch(/non-empty string/);
    expect(err).toMatch(/title/);
  });

  it('rejects a non-string provided value', () => {
    expect(optionalString(42, 'title')).toMatch(/non-empty string/);
    expect(optionalString({}, 'title')).toMatch(/non-empty string/);
  });
});

describe('formatToolError', () => {
  it('wraps an Error instance', () => {
    const result = formatToolError('Boom', new Error('disk full'));
    expect(result).toEqual({ ok: false, error: 'Boom: disk full' });
  });

  it('coerces non-Error throws to a string', () => {
    expect(formatToolError('Boom', 'plain string')).toEqual({
      ok: false,
      error: 'Boom: plain string',
    });
    expect(formatToolError('Boom', 42)).toEqual({
      ok: false,
      error: 'Boom: 42',
    });
    expect(formatToolError('Boom', undefined)).toEqual({
      ok: false,
      error: 'Boom: undefined',
    });
  });
});
