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
    ).generateAccessToken('my-addon', ['agents.list', 'agents.invoke']);

    const result = svc.validateAccessToken(token);
    expect(result).not.toBeNull();
    expect(result!.addonId).toBe('my-addon');
    expect(result!.permissions).toEqual(['agents.list', 'agents.invoke']);
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
    const addon = makeEnabledAddon('a', ['agents.list']);
    expect(proxyService.hasPermission(addon, 'agents.list')).toBe(true);
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
    opts: {
      assistantContent?: string;
      dispatchError?: string;
    } = {},
  ): SessionMessageService {
    const dispatchError = opts.dispatchError;
    return {
      dispatchAgent: vi.fn().mockResolvedValue(
        dispatchError
          ? { ok: false as const, error: dispatchError }
          : {
              ok: true as const,
              sessionId: 'session-123',
              done: Promise.resolve({
                ok: true as const,
                assistantMessage: {
                  content: opts.assistantContent ?? 'Hello from agent',
                },
              }),
            },
      ),
    } as unknown as SessionMessageService;
  }

  it('creates a session on first invoke and returns agent reply', async () => {
    const sessionSvc = makeSessionService({ assistantContent: 'Hi there!' });
    const agentSvc = new AddonProxyAgentService(sessionSvc);

    const result = await agentSvc.invoke('test-addon', 'agent-1', 'Hello?');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message).toBe('Hi there!');
    expect(result.sessionId).toBe('session-123');
    expect(result.agentId).toBe('agent-1');
    expect(sessionSvc.dispatchAgent).toHaveBeenCalledOnce();
    expect(sessionSvc.dispatchAgent).toHaveBeenCalledWith({
      agentId: 'agent-1',
      content: 'Hello?',
      sessionTitle: 'addon:test-addon:agent-1',
    });
  });

  it('reuses the cached session on subsequent invocations', async () => {
    const sessionSvc = makeSessionService({ assistantContent: 'Cached reply' });
    const agentSvc = new AddonProxyAgentService(sessionSvc);

    await agentSvc.invoke('test-addon', 'agent-1', 'First message');
    await agentSvc.invoke('test-addon', 'agent-1', 'Second message');

    expect(sessionSvc.dispatchAgent).toHaveBeenCalledTimes(2);
    // First call: no sessionId (new session)
    expect(vi.mocked(sessionSvc.dispatchAgent).mock.calls[0]![0]).toEqual({
      agentId: 'agent-1',
      content: 'First message',
      sessionTitle: 'addon:test-addon:agent-1',
    });
    // Second call: includes sessionId from cache
    expect(vi.mocked(sessionSvc.dispatchAgent).mock.calls[1]![0]).toEqual({
      agentId: 'agent-1',
      content: 'Second message',
      sessionId: 'session-123',
      sessionTitle: 'addon:test-addon:agent-1',
    });
  });

  it('uses separate sessions for different addon+agent pairs', async () => {
    const sessionSvc = makeSessionService();
    vi.mocked(sessionSvc.dispatchAgent)
      .mockResolvedValueOnce({
        ok: true,
        sessionId: 'session-A',
        done: Promise.resolve({
          ok: true as const,
          assistantMessage: { content: 'A' },
        }),
      } as never)
      .mockResolvedValueOnce({
        ok: true,
        sessionId: 'session-B',
        done: Promise.resolve({
          ok: true as const,
          assistantMessage: { content: 'B' },
        }),
      } as never);

    const agentSvc = new AddonProxyAgentService(sessionSvc);

    await agentSvc.invoke('addon-1', 'agent-x', 'msg');
    await agentSvc.invoke('addon-2', 'agent-x', 'msg');

    expect(sessionSvc.dispatchAgent).toHaveBeenCalledTimes(2);
    // First call: no sessionId (different addon+agent pair)
    expect(
      vi.mocked(sessionSvc.dispatchAgent).mock.calls[0]![0].sessionId,
    ).toBeUndefined();
    // Second call: no sessionId either (different addon)
    expect(
      vi.mocked(sessionSvc.dispatchAgent).mock.calls[1]![0].sessionId,
    ).toBeUndefined();
  });

  it('propagates dispatchAgent errors as ok:false result', async () => {
    const sessionSvc = makeSessionService({
      dispatchError: 'Agent not found.',
    });

    const agentSvc = new AddonProxyAgentService(sessionSvc);
    const result = await agentSvc.invoke(
      'test-addon',
      'missing-agent',
      'Hello',
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('dispatch.failed');
    expect(result.error.message).toBe('Agent not found.');
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
    ).generateAccessToken('read-only-addon', ['agents.list']); // missing agents.invoke

    const addon = makeEnabledAddon('read-only-addon', ['agents.list']);
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
    ).generateAccessToken('my-addon', ['agents.list', 'agents.invoke']);

    const addon = makeEnabledAddon('my-addon', [
      'agents.list',
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
      dispatchAgent: vi.fn().mockResolvedValue({
        ok: true,
        sessionId: 'sess-xyz',
        done: Promise.resolve({
          ok: true,
          assistantMessage: { content: 'The answer is 42.' },
        }),
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
