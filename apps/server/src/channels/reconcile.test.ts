import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import type { FastifyBaseLogger } from 'fastify';
import type {
  WhatsAppChannelConfig,
  DiscordChannelConfig,
} from '@openaidy/config';
import {
  createChannelRegistry,
  reconcileChannelRegistry,
  type ChannelRegistryDeps,
} from './index.js';

function makeDeps(): ChannelRegistryDeps {
  return {
    // WhatsAppChannel only touches sessionService when a message arrives, and
    // authBaseDir/logger only on connect() — none of which the reconcile
    // tests exercise, so lightweight stubs are enough.
    sessionService: {} as ChannelRegistryDeps['sessionService'],
    authBaseDir: path.join(os.tmpdir(), 'oa-reconcile-test'),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as FastifyBaseLogger,
  };
}

function wa(id: string, agentId = 'default'): WhatsAppChannelConfig {
  return { type: 'whatsapp', id, agentId, enabled: true, stripThinking: true };
}

function dc(id: string, agentId = 'default'): DiscordChannelConfig {
  return {
    type: 'discord',
    id,
    agentId,
    botToken: { kind: 'inline', value: 'tok' },
    respondToMentions: true,
    enabled: true,
    stripThinking: true,
  };
}

describe('createChannelRegistry', () => {
  it('builds a channel instance per whatsapp config entry', () => {
    const registry = createChannelRegistry([wa('a'), wa('b')], makeDeps());
    expect(
      registry
        .getAll()
        .map((c) => c.id)
        .sort(),
    ).toEqual(['a', 'b']);
    expect(registry.get('a')?.type).toBe('whatsapp');
  });

  it('handles undefined config as no channels', () => {
    const registry = createChannelRegistry(undefined, makeDeps());
    expect(registry.getAll()).toHaveLength(0);
  });

  it('builds a discord channel instance for a discord config entry', () => {
    const registry = createChannelRegistry([dc('d1'), wa('w1')], makeDeps());
    expect(registry.get('d1')?.type).toBe('discord');
    expect(registry.get('w1')?.type).toBe('whatsapp');
  });
});

describe('reconcileChannelRegistry', () => {
  it('registers a newly-added channel', async () => {
    const deps = makeDeps();
    const registry = createChannelRegistry([wa('a')], deps);

    await reconcileChannelRegistry(registry, [wa('a'), wa('b')], deps);

    expect(registry.has('a')).toBe(true);
    expect(registry.has('b')).toBe(true);
  });

  it('does NOT auto-connect a newly-added channel', async () => {
    const deps = makeDeps();
    const registry = createChannelRegistry([], deps);

    await reconcileChannelRegistry(registry, [wa('new')], deps);

    const channel = registry.get('new')!;
    const connectSpy = vi.spyOn(channel, 'connect');
    // Reconcile already ran; a freshly-registered channel must sit at
    // 'disconnected' until the user explicitly connects it (QR flow).
    expect(channel.getStatus()).toBe('disconnected');
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it('disconnects and removes a channel dropped from config', async () => {
    const deps = makeDeps();
    const registry = createChannelRegistry([wa('keep'), wa('drop')], deps);
    const dropped = registry.get('drop')!;
    const disconnectSpy = vi.spyOn(dropped, 'disconnect');

    await reconcileChannelRegistry(registry, [wa('keep')], deps);

    expect(disconnectSpy).toHaveBeenCalledOnce();
    expect(registry.has('drop')).toBe(false);
    expect(registry.has('keep')).toBe(true);
  });

  it('leaves an existing channel instance untouched', async () => {
    const deps = makeDeps();
    const registry = createChannelRegistry([wa('a')], deps);
    const before = registry.get('a');

    await reconcileChannelRegistry(registry, [wa('a'), wa('b')], deps);

    // Same object identity — not recreated (which would drop a live session).
    expect(registry.get('a')).toBe(before);
  });

  it('removes all channels when config becomes empty/undefined', async () => {
    const deps = makeDeps();
    const registry = createChannelRegistry([wa('a'), wa('b')], deps);

    await reconcileChannelRegistry(registry, undefined, deps);

    expect(registry.getAll()).toHaveLength(0);
  });
});
