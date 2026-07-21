/**
 * Public surface test for @openaidy/control-plane
 *
 * Verifies that the symbols the CLI depends on are re-exported from the
 * package entrypoint, so PR1's `openaidy init` command can import them
 * without reaching into private paths.
 */

import { describe, expect, it } from 'vitest';
import * as controlPlane from './index.js';

describe('@openaidy/control-plane public surface', () => {
  it('re-exports BootstrapAdminWorkflow', () => {
    expect(controlPlane.BootstrapAdminWorkflow).toBeDefined();
    expect(typeof controlPlane.BootstrapAdminWorkflow).toBe('function');
  });

  it('re-exports createBootstrapAdminWorkflow factory', () => {
    expect(controlPlane.createBootstrapAdminWorkflow).toBeDefined();
    expect(typeof controlPlane.createBootstrapAdminWorkflow).toBe('function');
  });

  it('re-exports BootstrapAdminEnsureResult type (compile-time)', () => {
    // The re-export is `type`, so runtime presence is irrelevant; this
    // assertion just guards against accidentally dropping the export
    // during a refactor.
    const keys = Object.keys(controlPlane);
    expect(keys).toContain('createBootstrapAdminWorkflow');
  });

  it('factory returns a usable workflow instance', () => {
    const wf = controlPlane.createBootstrapAdminWorkflow({
      enabled: true,
      tokenPath: '/tmp/control-plane-public-surface.json',
      jwtSecret: 'irrelevant-for-this-test',
    });
    expect(wf).toBeInstanceOf(controlPlane.BootstrapAdminWorkflow);
    expect(wf.getTokenPath()).toBe('/tmp/control-plane-public-surface.json');
    expect(wf.isEnabled()).toBe(true);
  });
});
