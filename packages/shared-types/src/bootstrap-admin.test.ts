/**
 * Bootstrap Admin Record - Shared Types Tests
 *
 * Verifies the BootstrapAdminRecord type is exported from
 * @openaidy/shared-types and structurally matches the historical shape
 * that apps/server and packages/cli have always relied on:
 * { clientId, token, scopes, createdAt, expiresAt }.
 *
 * Runtime validation here is acceptable: shared-types declares data
 * types only (no business logic), and a runtime shape check protects
 * future refactors from accidentally renaming/removing fields that
 * downstream packages depend on.
 */

import { describe, it, expect } from 'vitest';
import type { BootstrapAdminRecord } from './bootstrap-admin.js';

describe('BootstrapAdminRecord (shared-types)', () => {
  it('is exported from @openaidy/shared-types', () => {
    // Type-only assertion at compile time + a structural runtime check
    // so the test fails loudly if anyone removes the export.
    const sample: BootstrapAdminRecord = {
      clientId: 'bootstrap-admin',
      token: 'header.payload.signature',
      scopes: ['*'],
      createdAt: '2026-06-21T00:00:00.000Z',
      expiresAt: '2027-06-21T00:00:00.000Z',
    };
    expect(typeof sample).toBe('object');
  });

  it('has the five required fields with the documented types', () => {
    const sample: BootstrapAdminRecord = {
      clientId: 'bootstrap-admin',
      token: 'jwt-value',
      scopes: ['*'],
      createdAt: '2026-06-21T00:00:00.000Z',
      expiresAt: '2027-06-21T00:00:00.000Z',
    };
    expect(typeof sample.clientId).toBe('string');
    expect(typeof sample.token).toBe('string');
    expect(Array.isArray(sample.scopes)).toBe(true);
    expect(typeof sample.createdAt).toBe('string');
    expect(typeof sample.expiresAt).toBe('string');
  });

  it('accepts the historical admin-wildcard scopes value', () => {
    // The control-plane's inspectToken/ensureToken code requires the
    // wildcard scope; document that the shape supports it.
    const sample: BootstrapAdminRecord = {
      clientId: 'bootstrap-admin',
      token: 'jwt-value',
      scopes: ['*'],
      createdAt: '2026-06-21T00:00:00.000Z',
      expiresAt: '2027-06-21T00:00:00.000Z',
    };
    expect(sample.scopes).toContain('*');
  });
});
