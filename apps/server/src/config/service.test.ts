import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { OpenAidyAppConfig } from '@openaidy/config';
import { AppConfigService } from './service.js';
import type { ProviderServices } from '../providers';
import type { AgentRegistry } from '../agents';

// Deterministic stand-in for the AES secret-crypto so the encryption-on-save
// tests don't depend on a real master key.
vi.mock('../mcp/secret-crypto', () => ({
  encryptSecret: (plaintext: string) => `enc:v1:${plaintext}`,
  isEncryptedSecret: (value: string) => value.startsWith('enc:v1:'),
}));

/**
 * Minimal config that passes appConfigSchema without needing any real
 * providers: empty providers list + a model-less agent + no default provider
 * (the empty-install shape). Keeps applyConfig's provider loop and default
 * block from doing any real work, so we can focus on the channel-reconciler
 * wiring in save().
 */
function baseConfig(): OpenAidyAppConfig {
  return {
    version: 1,
    defaults: { agentId: 'default' },
    providers: [],
    agents: [
      {
        id: 'default',
        name: 'Default',
        systemPrompt: 'You are helpful.',
        enabled: true,
      },
    ],
  } as unknown as OpenAidyAppConfig;
}

// Providers/agents are no-op stubs — applyConfig only calls registry.clear()
// (empty provider loop) and agents.replaceAll() for this config shape.
function stubProviders(): ProviderServices {
  return {
    registry: {
      clear: vi.fn(),
      register: vi.fn(),
      has: vi.fn(() => false),
      setDefault: vi.fn(),
    },
  } as unknown as ProviderServices;
}

function stubAgents(): AgentRegistry {
  return { replaceAll: vi.fn() } as unknown as AgentRegistry;
}

describe('AppConfigService channel reconciler', () => {
  let dir: string;
  let configPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-config-test-'));
    configPath = path.join(dir, 'openaidy.json');
    fs.writeFileSync(configPath, JSON.stringify(baseConfig()), 'utf-8');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function makeService(): AppConfigService {
    return new AppConfigService({
      configPath,
      templatePath: configPath,
      providers: stubProviders(),
      agents: stubAgents(),
    });
  }

  it('invokes the reconciler with the saved channels on save()', async () => {
    const service = makeService();
    await service.load();
    const reconcile = vi.fn();
    service.setChannelReconciler(reconcile);

    const channels = [
      {
        type: 'whatsapp' as const,
        id: 'personal',
        agentId: 'default',
        enabled: true,
      },
    ];
    await service.save({ ...baseConfig(), channels });

    expect(reconcile).toHaveBeenCalledOnce();
    expect(reconcile).toHaveBeenCalledWith([{ ...channels[0], stripThinking: true }]);
  });

  it('passes undefined channels through when none are configured', async () => {
    const service = makeService();
    await service.load();
    const reconcile = vi.fn();
    service.setChannelReconciler(reconcile);

    await service.save(baseConfig());

    expect(reconcile).toHaveBeenCalledOnce();
    expect(reconcile).toHaveBeenCalledWith(undefined);
  });

  it('does not throw when no reconciler is registered', async () => {
    const service = makeService();
    await service.load();
    await expect(service.save(baseConfig())).resolves.toBeDefined();
  });

  it('encrypts an inline discord bot token on save', async () => {
    const service = makeService();
    await service.load();

    await service.save({
      ...baseConfig(),
      channels: [
        {
          type: 'discord',
          id: 'guild-bot',
          agentId: 'default',
          botToken: { kind: 'inline', value: 'super-secret-token' },
          enabled: true,
        },
      ],
    });

    const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(written.channels[0].botToken).toEqual({
      kind: 'inline',
      value: 'enc:v1:super-secret-token',
    });
  });

  it('leaves an already-encrypted token unchanged (idempotent)', async () => {
    const service = makeService();
    await service.load();

    await service.save({
      ...baseConfig(),
      channels: [
        {
          type: 'discord',
          id: 'guild-bot',
          agentId: 'default',
          botToken: { kind: 'inline', value: 'enc:v1:already' },
          enabled: true,
        },
      ],
    });

    const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(written.channels[0].botToken.value).toBe('enc:v1:already');
  });

  it('does not encrypt an env-var token reference on save', async () => {
    const service = makeService();
    await service.load();

    await service.save({
      ...baseConfig(),
      channels: [
        {
          type: 'discord',
          id: 'guild-bot',
          agentId: 'default',
          botToken: { kind: 'env', value: 'DISCORD_BOT_TOKEN' },
          enabled: true,
        },
      ],
    });

    const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(written.channels[0].botToken).toEqual({
      kind: 'env',
      value: 'DISCORD_BOT_TOKEN',
    });
  });
});
