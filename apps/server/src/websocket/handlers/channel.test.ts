/**
 * Channel Handler Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { ChannelHandler, registerChannelHandlers } from './channel';
import type { ChannelRegistry } from '../../channels/index';
import type { ConnectionManager } from '../connection-manager';
import type { HandlerContext, MessageHandler } from '../message-router';
import type {
  ChannelSubscribeRequest,
  ChannelUnsubscribeRequest,
  WSMessage,
} from '@openaidy/shared-types';

// ============================================================================
// Mocks
// ============================================================================

const createMockLogger = (): FastifyBaseLogger =>
  ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => createMockLogger()),
  }) as unknown as FastifyBaseLogger;

// Mock channel registry
const createMockChannelRegistry = () => ({
  get: vi.fn(),
  getAll: vi.fn(),
  register: vi.fn(),
  unregister: vi.fn(),
});

// Mock connection manager
const createMockConnectionManager = () => ({
  send: vi.fn().mockReturnValue(true),
  broadcast: vi.fn(),
  sendToTopic: vi.fn(),
});

// Mock channel instance
type MockChannelListeners = {
  qr: Set<(qr: string) => void>;
  status: Set<(status: string) => void>;
};

const createMockChannel = (
  overrides: {
    id?: string;
    status?: string;
    qr?: string;
  } = {},
) => {
  const listeners: MockChannelListeners = {
    qr: new Set(),
    status: new Set(),
  };
  return {
    id: overrides.id ?? 'test-channel',
    type: 'whatsapp' as const,
    agentId: 'agent-1',
    getStatus: vi.fn(() => overrides.status ?? 'disconnected'),
    getQr: vi.fn(() => overrides.qr),
    connect: vi.fn(),
    disconnect: vi.fn(),
    onQrUpdate: vi.fn((fn: (qr: string) => void) => {
      listeners.qr.add(fn);
      return () => listeners.qr.delete(fn);
    }),
    onStatusChange: vi.fn((fn: (status: string) => void) => {
      listeners.status.add(fn);
      return () => listeners.status.delete(fn);
    }),
    // Matches the real IChannel/IQrChannel contract: 'status' listeners are
    // removed via removeListener, 'qr' listeners via the separate
    // removeQrListener — NOT a single removeListener('qr' | 'status', ...).
    removeListener: vi.fn((_event: 'status', fn: (status: string) => void) => {
      listeners.status.delete(fn);
    }),
    removeQrListener: vi.fn((fn: (qr: string) => void) => {
      listeners.qr.delete(fn);
    }),
    // Helper to emit events for testing
    _emitQr: (qr: string) => listeners.qr.forEach((fn) => fn(qr)),
    _emitStatus: (status: string) =>
      listeners.status.forEach((fn) => fn(status)),
  };
};

// Mock message router
const createMockRouter = () => {
  return {
    registerHandler: vi.fn((_type: string, _handler: MessageHandler) => {}),
  };
};

// Helper to create a timestamp
const timestamp = () => new Date().toISOString();

// Helper to create a subscribe request
const createSubscribeRequest = (
  channelId: string,
  id = 'req-1',
): ChannelSubscribeRequest => ({
  id,
  type: 'channel.subscribe',
  timestamp: timestamp(),
  payload: { channelId },
});

// Helper to create an unsubscribe request
const createUnsubscribeRequest = (
  channelId: string,
  id = 'req-2',
): ChannelUnsubscribeRequest => ({
  id,
  type: 'channel.unsubscribe',
  timestamp: timestamp(),
  payload: { channelId },
});

// ============================================================================
// Tests
// ============================================================================

describe('ChannelHandler', () => {
  let mockChannelRegistry: ReturnType<typeof createMockChannelRegistry>;
  let mockConnectionManager: ReturnType<typeof createMockConnectionManager>;
  let mockLogger: FastifyBaseLogger;
  let channelHandler: ChannelHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    mockChannelRegistry = createMockChannelRegistry();
    mockConnectionManager = createMockConnectionManager();
    mockLogger = createMockLogger();
    channelHandler = new ChannelHandler(
      mockChannelRegistry as unknown as ChannelRegistry,
      mockConnectionManager as unknown as ConnectionManager,
      mockLogger,
    );
  });

  describe('handleSubscribe', () => {
    it('should return error for non-existent channel', async () => {
      vi.mocked(mockChannelRegistry.get).mockReturnValue(undefined);

      const request = createSubscribeRequest('nonexistent');

      const result = await channelHandler.handleSubscribe(
        'conn-1',
        request,
        {} as HandlerContext,
      );

      expect(result).toMatchObject({
        type: 'error',
        payload: {
          requestId: 'req-1',
          error: { code: 'NOT_FOUND' },
        },
      });
    });

    it('should subscribe to existing channel and send status', async () => {
      const mockChannel = createMockChannel({ id: 'personal', status: 'qr' });
      vi.mocked(mockChannelRegistry.get).mockReturnValue(mockChannel);

      const request = createSubscribeRequest('personal');

      const result = await channelHandler.handleSubscribe(
        'conn-1',
        request,
        {} as HandlerContext,
      );

      expect(result).toMatchObject({
        type: 'channel.subscribed',
        payload: { channelId: 'personal' },
      });

      // Should send status to connection
      expect(mockConnectionManager.send).toHaveBeenCalledWith(
        'conn-1',
        expect.objectContaining({
          type: 'channel.status',
          payload: { channelId: 'personal', status: 'qr' },
        }),
      );

      // Should setup listeners on channel
      expect(mockChannel.onQrUpdate).toHaveBeenCalled();
      expect(mockChannel.onStatusChange).toHaveBeenCalled();
    });

    it('should track subscriptions per connection', async () => {
      const mockChannel = createMockChannel({
        id: 'personal',
        status: 'disconnected',
      });
      vi.mocked(mockChannelRegistry.get).mockReturnValue(mockChannel);

      const request1 = createSubscribeRequest('personal', 'req-1');

      await channelHandler.handleSubscribe(
        'conn-1',
        request1,
        {} as HandlerContext,
      );

      const mockChannel2 = createMockChannel({
        id: 'work',
        status: 'disconnected',
      });
      vi.mocked(mockChannelRegistry.get).mockReturnValue(mockChannel2);
      const request2 = createSubscribeRequest('work', 'req-2');

      await channelHandler.handleSubscribe(
        'conn-1',
        request2,
        {} as HandlerContext,
      );

      // Both subscriptions should be tracked for same connection (2 status calls)
      const statusCalls = mockConnectionManager.send.mock.calls;
      expect(statusCalls.length).toBe(2);
    });
  });

  describe('handleUnsubscribe', () => {
    it('should handle unsubscribe request', async () => {
      const mockChannel = createMockChannel({ id: 'personal' });
      vi.mocked(mockChannelRegistry.get).mockReturnValue(mockChannel);

      // First subscribe
      const subscribeRequest = createSubscribeRequest('personal', 'req-1');
      await channelHandler.handleSubscribe(
        'conn-1',
        subscribeRequest,
        {} as HandlerContext,
      );

      // Then unsubscribe
      const unsubscribeRequest = createUnsubscribeRequest('personal', 'req-2');

      const result = await channelHandler.handleUnsubscribe(
        'conn-1',
        unsubscribeRequest,
        {} as HandlerContext,
      );

      expect(result).toMatchObject({
        type: 'channel.unsubscribed',
        payload: { channelId: 'personal' },
      });
    });

    it('removes the status listener from the channel, not just the bookkeeping Set', async () => {
      const mockChannel = createMockChannel({ id: 'personal' });
      vi.mocked(mockChannelRegistry.get).mockReturnValue(mockChannel);

      await channelHandler.handleSubscribe(
        'conn-1',
        createSubscribeRequest('personal', 'req-1'),
        {} as HandlerContext,
      );
      await channelHandler.handleUnsubscribe(
        'conn-1',
        createUnsubscribeRequest('personal', 'req-2'),
        {} as HandlerContext,
      );

      expect(mockChannel.removeListener).toHaveBeenCalled();
      mockConnectionManager.send.mockClear();

      // With the listener actually removed, a status change after
      // unsubscribing must not reach the (no longer interested) connection.
      mockChannel._emitStatus('connected');
      expect(mockConnectionManager.send).not.toHaveBeenCalled();
    });

    it('removes the QR listener via removeQrListener, not removeListener', async () => {
      const mockChannel = createMockChannel({ id: 'personal', status: 'qr' });
      vi.mocked(mockChannelRegistry.get).mockReturnValue(mockChannel);

      await channelHandler.handleSubscribe(
        'conn-1',
        createSubscribeRequest('personal', 'req-1'),
        {} as HandlerContext,
      );
      await channelHandler.handleUnsubscribe(
        'conn-1',
        createUnsubscribeRequest('personal', 'req-2'),
        {} as HandlerContext,
      );

      expect(mockChannel.removeQrListener).toHaveBeenCalled();
      mockConnectionManager.send.mockClear();

      mockChannel._emitQr('leaked-qr');
      expect(mockConnectionManager.send).not.toHaveBeenCalled();
    });

    it('does not accumulate a second listener when re-subscribing without an intervening unsubscribe', async () => {
      const mockChannel = createMockChannel({ id: 'personal' });
      vi.mocked(mockChannelRegistry.get).mockReturnValue(mockChannel);

      // Simulates a client retrying Connect before the previous attempt
      // settled — two subscribe requests, no unsubscribe in between.
      await channelHandler.handleSubscribe(
        'conn-1',
        createSubscribeRequest('personal', 'req-1'),
        {} as HandlerContext,
      );
      await channelHandler.handleSubscribe(
        'conn-1',
        createSubscribeRequest('personal', 'req-2'),
        {} as HandlerContext,
      );
      mockConnectionManager.send.mockClear();

      mockChannel._emitStatus('connected');

      // Exactly one forwarded status event, not two — a second registered
      // listener would double-send it.
      const statusSends = mockConnectionManager.send.mock.calls.filter(
        ([, msg]) => (msg as { type: string }).type === 'channel.status',
      );
      expect(statusSends.length).toBe(1);
    });
  });

  describe('QR and status event forwarding', () => {
    it('should forward QR events to subscribed connection', async () => {
      const mockChannel = createMockChannel({
        id: 'personal',
        status: 'qr',
        qr: 'base64qrcode',
      });
      vi.mocked(mockChannelRegistry.get).mockReturnValue(mockChannel);

      const request = createSubscribeRequest('personal');

      await channelHandler.handleSubscribe(
        'conn-1',
        request,
        {} as HandlerContext,
      );

      // Clear previous send calls from subscription
      mockConnectionManager.send.mockClear();

      // Emit QR event from channel
      mockChannel._emitQr('newbase64qr');

      // Should forward to connection
      expect(mockConnectionManager.send).toHaveBeenCalledWith(
        'conn-1',
        expect.objectContaining({
          type: 'channel.qr',
          payload: { channelId: 'personal', qr: 'newbase64qr' },
        }),
      );
    });

    it('should forward status events to subscribed connection', async () => {
      const mockChannel = createMockChannel({ id: 'personal', status: 'qr' });
      vi.mocked(mockChannelRegistry.get).mockReturnValue(mockChannel);

      const request = createSubscribeRequest('personal');

      await channelHandler.handleSubscribe(
        'conn-1',
        request,
        {} as HandlerContext,
      );
      mockConnectionManager.send.mockClear();

      // Emit status event from channel
      mockChannel._emitStatus('connected');

      expect(mockConnectionManager.send).toHaveBeenCalledWith(
        'conn-1',
        expect.objectContaining({
          type: 'channel.status',
          payload: { channelId: 'personal', status: 'connected' },
        }),
      );
    });
  });
});

describe('registerChannelHandlers', () => {
  it('should register channel.subscribe handler', () => {
    const router = createMockRouter();
    const handler = {} as ChannelHandler;

    registerChannelHandlers(
      router as unknown as {
        registerHandler: (
          type: string,
          handler: (
            connId: string,
            msg: WSMessage,
            ctx: HandlerContext,
          ) => Promise<unknown>,
        ) => void;
      },
      handler,
    );

    expect(router.registerHandler).toHaveBeenCalledWith(
      'channel.subscribe',
      expect.any(Function),
    );
  });

  it('should register channel.unsubscribe handler', () => {
    const router = createMockRouter();
    const handler = {} as ChannelHandler;

    registerChannelHandlers(
      router as unknown as {
        registerHandler: (
          type: string,
          handler: (
            connId: string,
            msg: WSMessage,
            ctx: HandlerContext,
          ) => Promise<unknown>,
        ) => void;
      },
      handler,
    );

    expect(router.registerHandler).toHaveBeenCalledWith(
      'channel.unsubscribe',
      expect.any(Function),
    );
  });
});
