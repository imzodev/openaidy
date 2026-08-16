/**
 * WhatsApp Service Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import type { WhatsAppChannelConfig } from '@openaidy/config';
import type { WhatsAppChannelDeps } from './types.js';

// Mock baileys before importing service
vi.mock('@whiskeysockets/baileys', () => {
  const mockSocket = {
    ev: {
      on: vi.fn(),
      off: vi.fn(),
    },
    on: vi.fn(),
    off: vi.fn(),
    sendText: vi.fn(),
    patch: vi.fn(),
  };
  return {
    default: vi.fn(() => mockSocket),
    DisconnectReason: {},
    fetchLatestBaileysVersion: vi
      .fn()
      .mockResolvedValue({ version: [2, 3000, 1035194821] }),
  };
});

vi.mock('./auth-store.js', () => ({
  createWhatsAppAuthStore: vi.fn().mockResolvedValue({
    state: { creds: {}, keys: {} },
    saveCreds: vi.fn(),
  }),
}));

describe('WhatsAppChannel', () => {
  let mockLogger: FastifyBaseLogger;
  let mockConfig: WhatsAppChannelConfig;
  let mockDeps: WhatsAppChannelDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as FastifyBaseLogger;

    mockConfig = {
      type: 'whatsapp',
      id: 'test-channel',
      agentId: 'test-agent',
      enabled: true,
      stripThinking: true,
    };

    mockDeps = {
      logger: mockLogger,
      authBaseDir: '/tmp/test-auth',
      sessionService: {} as WhatsAppChannelDeps['sessionService'],
    };
  });

  describe('constructor', () => {
    it('should set channel id and agentId from config', async () => {
      const { WhatsAppChannel } = await import('./service.js');
      const channel = new WhatsAppChannel(mockConfig, mockDeps);

      expect(channel.id).toBe('test-channel');
      expect(channel.type).toBe('whatsapp');
    });
  });

  describe('connect', () => {
    it('should create socket with correct browser configuration', async () => {
      const { WhatsAppChannel } = await import('./service.js');
      const { default: makeWASocket } = await import('@whiskeysockets/baileys');

      const channel = new WhatsAppChannel(mockConfig, mockDeps);
      await channel.connect();

      expect(makeWASocket).toHaveBeenCalledWith(
        expect.objectContaining({
          browser: ['OpenAidy', '1.0.0', 'Ubuntu'],
        }),
      );
    });

    it('should not create socket if already connected', async () => {
      const { WhatsAppChannel } = await import('./service.js');
      const { default: makeWASocket } = await import('@whiskeysockets/baileys');

      const channel = new WhatsAppChannel(mockConfig, mockDeps);
      await channel.connect();
      await channel.connect();

      expect(makeWASocket).toHaveBeenCalledTimes(1);
    });

    it('should create socket with browser name OpenAidy', async () => {
      const { WhatsAppChannel } = await import('./service.js');
      const { default: makeWASocket } = await import('@whiskeysockets/baileys');

      const channel = new WhatsAppChannel(mockConfig, mockDeps);
      await channel.connect();

      // Verify the browser configuration was passed
      expect(makeWASocket).toHaveBeenCalledWith(
        expect.objectContaining({
          browser: expect.arrayContaining(['OpenAidy']),
        }),
      );
    });
  });

  describe('disconnect', () => {
    it('should handle disconnect when not connected without error', async () => {
      const { WhatsAppChannel } = await import('./service.js');

      const channel = new WhatsAppChannel(mockConfig, mockDeps);
      // Should not throw when disconnecting without a socket
      await expect(channel.disconnect()).resolves.toBeUndefined();
    });
  });
});
