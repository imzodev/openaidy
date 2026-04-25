/**
 * Addon → Proxy → Agent invocation flow tests
 *
 * Covers the full path an addon request takes:
 *   1. Token validation  (AddonService.validateAccessToken)
 *   2. Permission check  (AddonProxyService.authorize / hasAgentAccess)
 *   3. Session reuse     (AddonProxyAgentService session cache)
 *   4. Agent invocation  (AddonProxyAgentService.invoke → submitMessage)
 *
 * All external dependencies (repository, SessionMessageService) are stubbed
 * with minimal in-memory implementations so the tests run without a database
 * or a running server.
 */

import { describe, it, expect, vi } from 'vitest';
import { AddonService } from './service';
import { AddonProxyService } from './proxy';
import { AddonProxyAgentService } from './proxy-agent-service';
import type { SessionMessageService } from '../sessions/service';
import type { Addon } from '@openaidy/db';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const JWT_SECRET = 'test-secret-at-least-32-chars-long!!';

function makeAddonService() {
  return new AddonService({
    repository: null as never, // token ops don't touch the repo
    validator: null as never,
    jwtSecret: JWT_SECRET,
    openAidyVersion: '0.0.0',
  });
}

function makeEnabledAddon(addonId: string, permissions: string[]): Addon {
  return {
    id: 'db-row-id',
    addonId,
    name: 'Test Addon',
    version: '1.0.0',
    status: 'enabled',
    permissions,
    manifest: { permissions },
    config: {},
    installedAt: new Date(),
    updatedAt: new Date(),
    installedBy: 'admin',
  } as unknown as Addon;
}

// Minimal stub for AddonService used by AddonProxyService.validateToken
function makeAddonServiceStub(addon: Addon | null, _jwtSecret = JWT_SECRET) {
  const svc = makeAddonService();
  // Override getAddon to return our fixture without hitting the DB
  vi.spyOn(svc as never, 'getAddon' as never).mockResolvedValue(addon as never);
  return svc;
}

// ---------------------------------------------------------------------------
// 1. Token generation and validation
// ---------------------------------------------------------------------------

describe('AddonService token round-trip', () => {
  it('validateAccessToken returns null for a garbage token', () => {
    const svc = makeAddonService();
    expect(
      (svc as ReturnType<typeof makeAddonService>).validateAccessToken(
        'not.a.token',
      ),
    ).toBeNull();
  });

  it('generates a valid token and validates it back', () => {
    const svc = makeAddonService();
    // Access private method via cast
    const token = (
      svc as unknown as {
        generateAccessToken: (id: string, perms: string[]) => string;
      }
    ).generateAccessToken('my-addon', ['agents.read', 'agents.invoke']);

    const result = svc.validateAccessToken(token);
    expect(result).not.toBeNull();
    expect(result!.addonId).toBe('my-addon');
    expect(result!.permissions).toEqual(['agents.read', 'agents.invoke']);
  });

  it('rejects a token signed with the wrong secret', () => {
    const svc = makeAddonService();
    const token = (
      svc as unknown as {
        generateAccessToken: (id: string, perms: string[]) => string;
      }
    ).generateAccessToken('my-addon', ['agents.invoke']);

    const wrongSvc = new AddonService({
      repository: null as never,
      validator: null as never,
      jwtSecret: 'different-secret-at-least-32-chars!!',
      openAidyVersion: '0.0.0',
    });
    expect(wrongSvc.validateAccessToken(token)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. AddonProxyService permission checks
// ---------------------------------------------------------------------------

describe('AddonProxyService permission checks', () => {
  const proxyService = new AddonProxyService(null as never, '');

  it('hasPermission: wildcard grants everything', () => {
    const addon = makeEnabledAddon('a', ['*']);
    expect(proxyService.hasPermission(addon, 'agents.invoke')).toBe(true);
    expect(proxyService.hasPermission(addon, 'sessions.read')).toBe(true);
  });

  it('hasPermission: exact match only', () => {
    const addon = makeEnabledAddon('a', ['agents.read']);
    expect(proxyService.hasPermission(addon, 'agents.read')).toBe(true);
    expect(proxyService.hasPermission(addon, 'agents.invoke')).toBe(false);
  });

  it('hasAgentAccess: unscoped agents.invoke grants all agents', () => {
    const addon = makeEnabledAddon('a', ['agents.invoke']);
    expect(proxyService.hasAgentAccess(addon, 'agent-1')).toBe(true);
    expect(proxyService.hasAgentAccess(addon, 'agent-2')).toBe(true);
  });

  it('hasAgentAccess: agents.* grants all agents', () => {
    const addon = makeEnabledAddon('a', ['agents.*']);
    expect(proxyService.hasAgentAccess(addon, 'any-agent')).toBe(true);
  });

  it('hasAgentAccess: scoped permission only allows the specified agent', () => {
    const addon = makeEnabledAddon('a', ['agents.invoke:agent-abc']);
    expect(proxyService.hasAgentAccess(addon, 'agent-abc')).toBe(true);
    expect(proxyService.hasAgentAccess(addon, 'agent-xyz')).toBe(false);
  });

  it('hasAgentAccess: no permission denies all agents', () => {
    const addon = makeEnabledAddon('a', ['sessions.read']);
    expect(proxyService.hasAgentAccess(addon, 'any-agent')).toBe(false);
  });

  it('authorize: returns error when permission missing', () => {
    const addon = makeEnabledAddon('a', ['sessions.read']);
    const result = proxyService.authorize(addon, 'agents.invoke');
    expect(result.authorized).toBe(false);
    expect(result.error).toContain('agents.invoke');
  });
});

// ---------------------------------------------------------------------------
// 3. AddonProxyService.validateToken (full token path)
// ---------------------------------------------------------------------------

describe('AddonProxyService.validateToken', () => {
  it('rejects an invalid token', async () => {
    const addonSvc = makeAddonServiceStub(null);
    const proxy = new AddonProxyService(addonSvc, '');
    const result = await proxy.validateToken('bad.token.here');
    expect(result.valid).toBe(false);
  });

  it('rejects a valid-signature token when addon is disabled', async () => {
    const addonSvc = makeAddonService();
    const token = (
      addonSvc as unknown as {
        generateAccessToken: (id: string, perms: string[]) => string;
      }
    ).generateAccessToken('my-addon', ['agents.invoke']);

    const disabledAddon = {
      ...makeEnabledAddon('my-addon', ['agents.invoke']),
      status: 'disabled',
    } as unknown as Addon;
    vi.spyOn(addonSvc as never, 'getAddon' as never).mockResolvedValue(
      disabledAddon as never,
    );

    const proxy = new AddonProxyService(addonSvc, '');
    const result = await proxy.validateToken(token);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/not enabled/i);
  });

  it('accepts a valid token for an enabled addon', async () => {
    const addonSvc = makeAddonService();
    const token = (
      addonSvc as unknown as {
        generateAccessToken: (id: string, perms: string[]) => string;
      }
    ).generateAccessToken('my-addon', ['agents.invoke']);

    const addon = makeEnabledAddon('my-addon', ['agents.invoke']);
    vi.spyOn(addonSvc as never, 'getAddon' as never).mockResolvedValue(
      addon as never,
    );

    const proxy = new AddonProxyService(addonSvc, '');
    const result = await proxy.validateToken(token);
    expect(result.valid).toBe(true);
    expect(result.addonId).toBe('my-addon');
    expect(result.permissions).toEqual(['agents.invoke']);
  });
});

// ---------------------------------------------------------------------------
// 4. AddonProxyAgentService — session reuse and invocation
// ---------------------------------------------------------------------------

describe('AddonProxyAgentService', () => {
  function makeSessionService(
    assistantContent = 'Hello from agent',
  ): SessionMessageService {
    return {
      createSession: vi
        .fn()
        .mockResolvedValue({
          id: 'session-123',
          title: 'addon:test-addon:agent-1',
        }),
      submitMessage: vi.fn().mockResolvedValue({
        ok: true,
        assistantMessage: { content: assistantContent },
      }),
    } as unknown as SessionMessageService;
  }

  it('creates a session on first invoke and returns agent reply', async () => {
    const sessionSvc = makeSessionService('Hi there!');
    const agentSvc = new AddonProxyAgentService(sessionSvc);

    const result = await agentSvc.invoke('test-addon', 'agent-1', 'Hello?');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message).toBe('Hi there!');
    expect(result.sessionId).toBe('session-123');
    expect(result.agentId).toBe('agent-1');
    expect(sessionSvc.createSession).toHaveBeenCalledOnce();
    expect(sessionSvc.createSession).toHaveBeenCalledWith(
      'addon:test-addon:agent-1',
    );
  });

  it('reuses the cached session on subsequent invocations', async () => {
    const sessionSvc = makeSessionService('Cached reply');
    const agentSvc = new AddonProxyAgentService(sessionSvc);

    await agentSvc.invoke('test-addon', 'agent-1', 'First message');
    await agentSvc.invoke('test-addon', 'agent-1', 'Second message');

    // createSession must only be called once — second call reuses the cache
    expect(sessionSvc.createSession).toHaveBeenCalledOnce();
    expect(sessionSvc.submitMessage).toHaveBeenCalledTimes(2);
  });

  it('uses separate sessions for different addon+agent pairs', async () => {
    const sessionSvc = makeSessionService();
    vi.mocked(sessionSvc.createSession)
      .mockResolvedValueOnce({ id: 'session-A' } as never)
      .mockResolvedValueOnce({ id: 'session-B' } as never);

    const agentSvc = new AddonProxyAgentService(sessionSvc);

    await agentSvc.invoke('addon-1', 'agent-x', 'msg');
    await agentSvc.invoke('addon-2', 'agent-x', 'msg');

    expect(sessionSvc.createSession).toHaveBeenCalledTimes(2);
    expect(
      vi.mocked(sessionSvc.submitMessage).mock.calls[0]![0].sessionId,
    ).toBe('session-A');
    expect(
      vi.mocked(sessionSvc.submitMessage).mock.calls[1]![0].sessionId,
    ).toBe('session-B');
  });

  it('propagates submitMessage errors as ok:false result', async () => {
    const sessionSvc = makeSessionService();
    vi.mocked(sessionSvc.submitMessage).mockResolvedValue({
      ok: false,
      error: { code: 'agent.not_found', message: 'Agent not found' },
    } as never);

    const agentSvc = new AddonProxyAgentService(sessionSvc);
    const result = await agentSvc.invoke(
      'test-addon',
      'missing-agent',
      'Hello',
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('agent.not_found');
    expect(result.error.message).toBe('Agent not found');
  });
});

// ---------------------------------------------------------------------------
// 5. End-to-end flow: token → permission check → agent invocation
// ---------------------------------------------------------------------------

describe('Full addon → proxy → agent flow', () => {
  it('rejects invocation when addon has no agents.invoke permission', async () => {
    const addonSvc = makeAddonService();
    const token = (
      addonSvc as unknown as {
        generateAccessToken: (id: string, perms: string[]) => string;
      }
    ).generateAccessToken('read-only-addon', ['agents.read']); // missing agents.invoke

    const addon = makeEnabledAddon('read-only-addon', ['agents.read']);
    vi.spyOn(addonSvc as never, 'getAddon' as never).mockResolvedValue(
      addon as never,
    );

    const proxy = new AddonProxyService(addonSvc, '');

    const tokenResult = await proxy.validateToken(token);
    expect(tokenResult.valid).toBe(true);

    const authResult = proxy.authorize(addon, 'agents.invoke');
    expect(authResult.authorized).toBe(false);
  });

  it('completes the full flow for a valid addon with agents.invoke permission', async () => {
    const addonSvc = makeAddonService();
    const token = (
      addonSvc as unknown as {
        generateAccessToken: (id: string, perms: string[]) => string;
      }
    ).generateAccessToken('my-addon', ['agents.read', 'agents.invoke']);

    const addon = makeEnabledAddon('my-addon', [
      'agents.read',
      'agents.invoke',
    ]);
    vi.spyOn(addonSvc as never, 'getAddon' as never).mockResolvedValue(
      addon as never,
    );

    const proxy = new AddonProxyService(addonSvc, '');

    // Step 1: validate token
    const tokenResult = await proxy.validateToken(token);
    expect(tokenResult.valid).toBe(true);
    expect(tokenResult.addonId).toBe('my-addon');

    // Step 2: authorize
    const authResult = proxy.authorize(addon, 'agents.invoke');
    expect(authResult.authorized).toBe(true);

    // Step 3: check agent access
    expect(proxy.hasAgentAccess(addon, 'some-agent')).toBe(true);

    // Step 4: invoke agent
    const sessionSvc: SessionMessageService = {
      createSession: vi.fn().mockResolvedValue({ id: 'sess-xyz' }),
      submitMessage: vi.fn().mockResolvedValue({
        ok: true,
        assistantMessage: { content: 'The answer is 42.' },
      }),
    } as unknown as SessionMessageService;

    const agentSvc = new AddonProxyAgentService(sessionSvc);
    const invokeResult = await agentSvc.invoke(
      'my-addon',
      'some-agent',
      'What is the answer?',
    );

    expect(invokeResult.ok).toBe(true);
    if (!invokeResult.ok) return;
    expect(invokeResult.message).toBe('The answer is 42.');
    expect(invokeResult.sessionId).toBe('sess-xyz');
  });
});
