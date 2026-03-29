import { describe, it, expect } from 'vitest';
import {
  isWSMessage,
  isWSError,
  isRequestType,
  isResponseType,
  isStreamEventType,
  isWSRequest,
  isWSResponse,
  isSessionStreamEvent,
  isErrorResponse,
  validateWSMessage,
  createWSMessage,
  createErrorResponse,
  createWSError,
  WS_ERROR_CODES,
  WS_CAPABILITIES,
  type WSMessage,
  type WSError,
  type SessionStreamEvent,
  type ErrorResponse,
  // Session event types and guards
  isSessionEventType,
  isSessionEvent,
  isSessionCreatedEvent,
  isSessionMessageEvent,
  isSessionDeletedEvent,
  isSessionUpdatedEvent,
  isSessionStreamStart,
  isSessionStreamDelta,
  isSessionStreamToolCall,
  isSessionStreamUsage,
  isSessionStreamEnd,
  isSessionStreamError,
  type SessionEvent,
  type SessionCreatedEvent,
  type SessionMessageEvent,
  type SessionDeletedEvent,
  type SessionUpdatedEvent,
  // Agent event types and guards
  isAgentEventType,
  isAgentEvent,
  isAgentCreatedEvent,
  isAgentUpdatedEvent,
  isAgentDeletedEvent,
  isAgentEnabledEvent,
  isAgentDisabledEvent,
  type AgentEvent,
  type AgentCreatedEvent,
  type AgentUpdatedEvent,
  type AgentDeletedEvent,
  type AgentEnabledEvent,
  type AgentDisabledEvent,
  // Provider event types and guards
  isProviderEventType,
  isProviderEvent,
  isProviderRegisteredEvent,
  isProviderUpdatedEvent,
  isProviderUnregisteredEvent,
  isModelAddedEvent,
  type ProviderEvent,
  type ProviderRegisteredEvent,
  type ProviderUpdatedEvent,
  type ProviderUnregisteredEvent,
  type ModelAddedEvent,
  // Node event types and guards
  isNodeEventType,
  isNodeEvent,
  isNodeRegisteredEvent,
  isNodeOnlineEvent,
  isNodeOfflineEvent,
  isNodeInvokedEvent,
  isNodeUpdatedEvent,
  isNodeUnregisteredEvent,
  type NodeEvent,
  type NodeRegisteredEvent,
  type NodeOnlineEvent,
  type NodeOfflineEvent,
  type NodeInvokedEvent,
  type NodeUpdatedEvent,
  type NodeUnregisteredEvent,
  // Pairing event types and guards
  isPairingEventType,
  isPairingEvent,
  isPairingRequestedEvent,
  isPairingApprovedEvent,
  isPairingDeniedEvent,
  type PairingEvent,
  type PairingRequestedEvent,
  type PairingApprovedEvent,
  type PairingDeniedEvent,
  // Config event types and guards
  isConfigEventType,
  isConfigEvent,
  isConfigUpdatedEvent,
  isConfigReloadedEvent,
  isConfigValidationErrorEvent,
  type ConfigEvent,
  type ConfigUpdatedEvent,
  type ConfigReloadedEvent,
  type ConfigValidationErrorEvent,
  // Presence event types and guards
  isPresenceEventType,
  isPresenceEvent,
  isPresenceChangedEvent,
  isPresenceOnlineEvent,
  isPresenceOfflineEvent,
  isPresenceSubscribedEvent,
  isPresenceUnsubscribedEvent,
  type PresenceEvent,
  type PresenceChangedEvent,
  type PresenceOnlineEvent,
  type PresenceOfflineEvent,
  type PresenceSubscribedEvent,
  type PresenceUnsubscribedEvent,
  type PresenceStatus,
} from './websocket';

describe('websocket types', () => {
  describe('isWSMessage', () => {
    it('should return true for valid WSMessage', () => {
      const msg = {
        id: '123',
        type: 'session.create',
        timestamp: new Date().toISOString(),
        payload: {},
      };
      expect(isWSMessage(msg)).toBe(true);
    });

    it('should return false for non-objects', () => {
      expect(isWSMessage(null)).toBe(false);
      expect(isWSMessage(undefined)).toBe(false);
      expect(isWSMessage('string')).toBe(false);
      expect(isWSMessage(123)).toBe(false);
    });

    it('should return false for missing required fields', () => {
      expect(isWSMessage({})).toBe(false);
      expect(isWSMessage({ id: '123' })).toBe(false);
      expect(isWSMessage({ id: '123', type: 'test' })).toBe(false);
      expect(isWSMessage({ id: '123', type: 'test', timestamp: '2024-01-01' })).toBe(false);
    });

    it('should return false for wrong field types', () => {
      expect(isWSMessage({ id: 123, type: 'test', timestamp: '2024-01-01', payload: {} })).toBe(false);
      expect(isWSMessage({ id: '123', type: 123, timestamp: '2024-01-01', payload: {} })).toBe(false);
      expect(isWSMessage({ id: '123', type: 'test', timestamp: 123, payload: {} })).toBe(false);
    });
  });

  describe('isWSError', () => {
    it('should return true for valid WSError', () => {
      const err = { code: 'TEST_ERROR', message: 'Test error message' };
      expect(isWSError(err)).toBe(true);
    });

    it('should return true for WSError with details', () => {
      const err = {
        code: 'TEST_ERROR',
        message: 'Test error',
        details: { foo: 'bar' },
      };
      expect(isWSError(err)).toBe(true);
    });

    it('should return false for non-objects', () => {
      expect(isWSError(null)).toBe(false);
      expect(isWSError(undefined)).toBe(false);
      expect(isWSError('string')).toBe(false);
    });

    it('should return false for missing required fields', () => {
      expect(isWSError({})).toBe(false);
      expect(isWSError({ code: 'TEST' })).toBe(false);
      expect(isWSError({ message: 'Test' })).toBe(false);
    });
  });

  describe('isRequestType', () => {
    it('should return true for valid request types', () => {
      expect(isRequestType('session.create')).toBe(true);
      expect(isRequestType('session.get')).toBe(true);
      expect(isRequestType('session.list')).toBe(true);
      expect(isRequestType('session.message')).toBe(true);
      expect(isRequestType('agent.list')).toBe(true);
      expect(isRequestType('provider.list')).toBe(true);
      expect(isRequestType('node.invoke')).toBe(true);
      expect(isRequestType('auth.authenticate')).toBe(true);
    });

    it('should return false for response types', () => {
      expect(isRequestType('session.created')).toBe(false);
      expect(isRequestType('session.stream.start')).toBe(false);
      expect(isRequestType('error')).toBe(false);
    });

    it('should return false for unknown types', () => {
      expect(isRequestType('unknown.type')).toBe(false);
      expect(isRequestType('')).toBe(false);
    });
  });

  describe('isResponseType', () => {
    it('should return true for valid response types', () => {
      expect(isResponseType('session.created')).toBe(true);
      expect(isResponseType('session.message')).toBe(true);
      expect(isResponseType('session.stream.start')).toBe(true);
      expect(isResponseType('session.stream.delta')).toBe(true);
      expect(isResponseType('agent.list')).toBe(true);
      expect(isResponseType('error')).toBe(true);
    });

    it('should return false for request types', () => {
      expect(isResponseType('session.create')).toBe(false);
      expect(isResponseType('session.get')).toBe(false);
    });

    it('should return false for unknown types', () => {
      expect(isResponseType('unknown.type')).toBe(false);
      expect(isResponseType('')).toBe(false);
    });
  });

  describe('isStreamEventType', () => {
    it('should return true for stream event types', () => {
      expect(isStreamEventType('session.stream.start')).toBe(true);
      expect(isStreamEventType('session.stream.delta')).toBe(true);
      expect(isStreamEventType('session.stream.tool_call')).toBe(true);
      expect(isStreamEventType('session.stream.usage')).toBe(true);
      expect(isStreamEventType('session.stream.end')).toBe(true);
      expect(isStreamEventType('session.stream.error')).toBe(true);
    });

    it('should return false for non-stream types', () => {
      expect(isStreamEventType('session.created')).toBe(false);
      expect(isStreamEventType('session.message')).toBe(false);
      expect(isStreamEventType('error')).toBe(false);
    });
  });

  describe('isWSRequest', () => {
    it('should return true for valid WSRequest', () => {
      const msg = {
        id: '123',
        type: 'session.create',
        timestamp: new Date().toISOString(),
        payload: {},
      };
      expect(isWSRequest(msg)).toBe(true);
    });

    it('should return false for response messages', () => {
      const msg = {
        id: '123',
        type: 'session.created',
        timestamp: new Date().toISOString(),
        payload: {},
      };
      expect(isWSRequest(msg)).toBe(false);
    });
  });

  describe('isWSResponse', () => {
    it('should return true for valid WSResponse', () => {
      const msg = {
        id: '123',
        type: 'session.created',
        timestamp: new Date().toISOString(),
        payload: { sessionId: 's1' },
      };
      expect(isWSResponse(msg)).toBe(true);
    });

    it('should return false for request messages', () => {
      const msg = {
        id: '123',
        type: 'session.create',
        timestamp: new Date().toISOString(),
        payload: {},
      };
      expect(isWSResponse(msg)).toBe(false);
    });
  });

  describe('isSessionStreamEvent', () => {
    it('should return true for stream events', () => {
      const msg = {
        id: '123',
        type: 'session.stream.delta',
        timestamp: new Date().toISOString(),
        payload: { sessionId: 's1', runId: 'r1', delta: 'Hello', content: 'Hello' },
      };
      expect(isSessionStreamEvent(msg)).toBe(true);
    });

    it('should return false for non-stream events', () => {
      const msg = {
        id: '123',
        type: 'session.created',
        timestamp: new Date().toISOString(),
        payload: {},
      };
      expect(isSessionStreamEvent(msg)).toBe(false);
    });
  });

  describe('isErrorResponse', () => {
    it('should return true for error responses', () => {
      const msg = {
        id: '123',
        type: 'error',
        timestamp: new Date().toISOString(),
        payload: {
          requestId: '456',
          error: { code: 'TEST_ERROR', message: 'Test error' },
        },
      };
      expect(isErrorResponse(msg)).toBe(true);
    });

    it('should return false for non-error responses', () => {
      const msg = {
        id: '123',
        type: 'session.created',
        timestamp: new Date().toISOString(),
        payload: {},
      };
      expect(isErrorResponse(msg)).toBe(false);
    });
  });

  describe('validateWSMessage', () => {
    it('should return valid message for correct structure', () => {
      const msg = {
        id: '123',
        type: 'session.create',
        timestamp: new Date().toISOString(),
        payload: {},
      };
      const result = validateWSMessage(msg);
      expect(isWSMessage(result)).toBe(true);
      if (isWSMessage(result)) {
        expect(result.id).toBe('123');
        expect(result.type).toBe('session.create');
      }
    });

    it('should return error for invalid message structure', () => {
      const result = validateWSMessage({ id: '123' });
      expect(isWSError(result)).toBe(true);
      if (isWSError(result)) {
        expect(result.code).toBe(WS_ERROR_CODES.INVALID_REQUEST);
      }
    });

    it('should return error for invalid timestamp', () => {
      const msg = {
        id: '123',
        type: 'session.create',
        timestamp: 'invalid-date',
        payload: {},
      };
      const result = validateWSMessage(msg);
      expect(isWSError(result)).toBe(true);
      if (isWSError(result)) {
        expect(result.code).toBe(WS_ERROR_CODES.INVALID_PAYLOAD);
      }
    });
  });

  describe('createWSMessage', () => {
    it('should create a message with auto-generated ID and timestamp', () => {
      const msg = createWSMessage('session.create', { agentId: 'agent-1' });
      
      expect(msg.type).toBe('session.create');
      expect(msg.payload).toEqual({ agentId: 'agent-1' });
      expect(msg.id).toBeDefined();
      expect(typeof msg.id).toBe('string');
      expect(msg.timestamp).toBeDefined();
      
      // Validate timestamp is ISO 8601
      const timestamp = Date.parse(msg.timestamp);
      expect(isNaN(timestamp)).toBe(false);
    });

    it('should create a message with provided ID', () => {
      const msg = createWSMessage('session.get', { sessionId: 's1' }, 'custom-id');
      expect(msg.id).toBe('custom-id');
    });
  });

  describe('createErrorResponse', () => {
    it('should create an error response message', () => {
      const response = createErrorResponse(
        'req-123',
        WS_ERROR_CODES.INVALID_PAYLOAD,
        'Invalid payload provided',
        { field: 'sessionId' },
      );

      expect(response.type).toBe('error');
      expect(response.payload.requestId).toBe('req-123');
      expect(response.payload.error.code).toBe(WS_ERROR_CODES.INVALID_PAYLOAD);
      expect(response.payload.error.message).toBe('Invalid payload provided');
      expect(response.payload.error.details).toEqual({ field: 'sessionId' });
    });

    it('should create error response without details', () => {
      const response = createErrorResponse(
        'req-123',
        WS_ERROR_CODES.NOT_FOUND,
        'Resource not found',
      );

      expect(response.payload.error.details).toBeUndefined();
    });
  });

  describe('createWSError', () => {
    it('should create a WSError object', () => {
      const error = createWSError(
        WS_ERROR_CODES.AUTH_FAILED,
        'Authentication failed',
        { reason: 'invalid_token' },
      );

      expect(error.code).toBe(WS_ERROR_CODES.AUTH_FAILED);
      expect(error.message).toBe('Authentication failed');
      expect(error.details).toEqual({ reason: 'invalid_token' });
    });

    it('should create WSError without details', () => {
      const error = createWSError(WS_ERROR_CODES.FORBIDDEN, 'Access denied');
      expect(error.details).toBeUndefined();
    });
  });

  describe('WS_ERROR_CODES', () => {
    it('should have all expected error codes', () => {
      expect(WS_ERROR_CODES.AUTH_FAILED).toBe('AUTH_FAILED');
      expect(WS_ERROR_CODES.AUTH_REQUIRED).toBe('AUTH_REQUIRED');
      expect(WS_ERROR_CODES.TOKEN_EXPIRED).toBe('TOKEN_EXPIRED');
      expect(WS_ERROR_CODES.FORBIDDEN).toBe('FORBIDDEN');
      expect(WS_ERROR_CODES.INVALID_REQUEST).toBe('INVALID_REQUEST');
      expect(WS_ERROR_CODES.RATE_LIMITED).toBe('RATE_LIMITED');
      expect(WS_ERROR_CODES.NOT_FOUND).toBe('NOT_FOUND');
      expect(WS_ERROR_CODES.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
    });
  });

  describe('WS_CAPABILITIES', () => {
    it('should have all expected capabilities', () => {
      expect(WS_CAPABILITIES.SESSIONS_READ).toBe('sessions.read');
      expect(WS_CAPABILITIES.SESSIONS_WRITE).toBe('sessions.write');
      expect(WS_CAPABILITIES.SESSIONS_STREAM).toBe('sessions.stream');
      expect(WS_CAPABILITIES.AGENTS_READ).toBe('agents.read');
      expect(WS_CAPABILITIES.PROVIDERS_READ).toBe('providers.read');
      expect(WS_CAPABILITIES.NODE_INVOKE).toBe('node.invoke');
      expect(WS_CAPABILITIES.CONFIG_READ).toBe('config.read');
      expect(WS_CAPABILITIES.PAIRING_APPROVE).toBe('pairing.approve');
      expect(WS_CAPABILITIES.ADMIN).toBe('*');
    });
  });

  describe('Type guards with full messages', () => {
    it('should correctly identify a SessionCreateRequest', () => {
      const msg = createWSMessage('session.create', { agentId: 'agent-1' });
      expect(isWSRequest(msg)).toBe(true);
      expect(isWSResponse(msg)).toBe(false);
    });

    it('should correctly identify a SessionCreatedResponse', () => {
      const msg = createWSMessage('session.created', {
        sessionId: 's1',
        agentId: 'a1',
        createdAt: new Date().toISOString(),
      });
      expect(isWSRequest(msg)).toBe(false);
      expect(isWSResponse(msg)).toBe(true);
    });

    it('should correctly identify a stream event', () => {
      const msg = createWSMessage('session.stream.delta', {
        sessionId: 's1',
        runId: 'r1',
        delta: 'Hello',
        content: 'Hello World',
      });
      expect(isSessionStreamEvent(msg)).toBe(true);
      expect(isWSResponse(msg)).toBe(true);
    });
  });

  describe('Serialization', () => {
    it('should serialize and deserialize messages correctly', () => {
      const original = createWSMessage('session.create', {
        agentId: 'agent-1',
        metadata: { foo: 'bar' },
      });

      const json = JSON.stringify(original);
      const parsed = JSON.parse(json);

      expect(isWSMessage(parsed)).toBe(true);
      expect(parsed.id).toBe(original.id);
      expect(parsed.type).toBe(original.type);
      expect(parsed.payload).toEqual(original.payload);
    });

    it('should serialize error responses correctly', () => {
      const error = createErrorResponse(
        'req-1',
        WS_ERROR_CODES.INTERNAL_ERROR,
        'Something went wrong',
      );

      const json = JSON.stringify(error);
      const parsed = JSON.parse(json);

      expect(isErrorResponse(parsed)).toBe(true);
      expect(parsed.payload.error.code).toBe(WS_ERROR_CODES.INTERNAL_ERROR);
    });
  });

  // ============================================================================
  // Session Event Type Guards Tests
  // ============================================================================

  describe('Session Event Type Guards', () => {
    describe('isSessionEventType', () => {
      it('should return true for session event types', () => {
        expect(isSessionEventType('session.created')).toBe(true);
        expect(isSessionEventType('session.message')).toBe(true);
        expect(isSessionEventType('session.deleted')).toBe(true);
        expect(isSessionEventType('session.updated')).toBe(true);
      });

      it('should return false for non-session event types', () => {
        expect(isSessionEventType('session.create')).toBe(false);
        expect(isSessionEventType('session.stream.start')).toBe(false);
        expect(isSessionEventType('error')).toBe(false);
      });
    });

    describe('isSessionEvent', () => {
      it('should return true for session.created event', () => {
        const msg = createWSMessage('session.created', {
          sessionId: 's1',
          agentId: 'a1',
          createdAt: new Date().toISOString(),
        });
        expect(isSessionEvent(msg)).toBe(true);
      });

      it('should return true for session.message event', () => {
        const msg = createWSMessage('session.message', {
          sessionId: 's1',
          messageId: 'm1',
          role: 'assistant',
          content: 'Hello!',
          createdAt: new Date().toISOString(),
        });
        expect(isSessionEvent(msg)).toBe(true);
      });

      it('should return true for session.deleted event', () => {
        const msg = createWSMessage('session.deleted', {
          sessionId: 's1',
          deletedAt: new Date().toISOString(),
        });
        expect(isSessionEvent(msg)).toBe(true);
      });

      it('should return true for session.updated event', () => {
        const msg = createWSMessage('session.updated', {
          sessionId: 's1',
          updates: { title: 'New Title' },
          updatedAt: new Date().toISOString(),
        });
        expect(isSessionEvent(msg)).toBe(true);
      });

      it('should return false for non-session events', () => {
        const msg = createWSMessage('session.stream.start', {
          sessionId: 's1',
          runId: 'r1',
          agentId: 'a1',
          providerId: 'p1',
          modelId: 'm1',
        });
        expect(isSessionEvent(msg)).toBe(false);
      });
    });

    describe('isSessionCreatedEvent', () => {
      it('should return true for session.created event', () => {
        const msg = createWSMessage('session.created', {
          sessionId: 's1',
          agentId: 'a1',
          createdAt: new Date().toISOString(),
        });
        expect(isSessionCreatedEvent(msg)).toBe(true);
      });

      it('should return false for other event types', () => {
        const msg = createWSMessage('session.deleted', {
          sessionId: 's1',
          deletedAt: new Date().toISOString(),
        });
        expect(isSessionCreatedEvent(msg)).toBe(false);
      });
    });

    describe('isSessionMessageEvent', () => {
      it('should return true for session.message event', () => {
        const msg = createWSMessage('session.message', {
          sessionId: 's1',
          messageId: 'm1',
          role: 'user',
          content: 'Hello!',
          createdAt: new Date().toISOString(),
        });
        expect(isSessionMessageEvent(msg)).toBe(true);
      });

      it('should return false for other event types', () => {
        const msg = createWSMessage('session.created', {
          sessionId: 's1',
          agentId: 'a1',
          createdAt: new Date().toISOString(),
        });
        expect(isSessionMessageEvent(msg)).toBe(false);
      });
    });

    describe('isSessionDeletedEvent', () => {
      it('should return true for session.deleted event', () => {
        const msg = createWSMessage('session.deleted', {
          sessionId: 's1',
          deletedAt: new Date().toISOString(),
        });
        expect(isSessionDeletedEvent(msg)).toBe(true);
      });

      it('should return false for other event types', () => {
        const msg = createWSMessage('session.updated', {
          sessionId: 's1',
          updates: {},
          updatedAt: new Date().toISOString(),
        });
        expect(isSessionDeletedEvent(msg)).toBe(false);
      });
    });

    describe('isSessionUpdatedEvent', () => {
      it('should return true for session.updated event', () => {
        const msg = createWSMessage('session.updated', {
          sessionId: 's1',
          updates: { title: 'New Title' },
          updatedAt: new Date().toISOString(),
        });
        expect(isSessionUpdatedEvent(msg)).toBe(true);
      });

      it('should return false for other event types', () => {
        const msg = createWSMessage('session.deleted', {
          sessionId: 's1',
          deletedAt: new Date().toISOString(),
        });
        expect(isSessionUpdatedEvent(msg)).toBe(false);
      });
    });
  });

  // ============================================================================
  // Session Stream Event Type Guards Tests
  // ============================================================================

  describe('Session Stream Event Type Guards', () => {
    describe('isSessionStreamStart', () => {
      it('should return true for session.stream.start event', () => {
        const msg = createWSMessage('session.stream.start', {
          sessionId: 's1',
          runId: 'r1',
          agentId: 'a1',
          providerId: 'p1',
          modelId: 'm1',
        });
        expect(isSessionStreamStart(msg)).toBe(true);
        expect(isSessionStreamEvent(msg)).toBe(true);
      });

      it('should return false for other stream events', () => {
        const msg = createWSMessage('session.stream.delta', {
          sessionId: 's1',
          runId: 'r1',
          delta: 'Hello',
          content: 'Hello',
        });
        expect(isSessionStreamStart(msg)).toBe(false);
      });
    });

    describe('isSessionStreamDelta', () => {
      it('should return true for session.stream.delta event', () => {
        const msg = createWSMessage('session.stream.delta', {
          sessionId: 's1',
          runId: 'r1',
          delta: 'lo',
          content: 'Hello',
        });
        expect(isSessionStreamDelta(msg)).toBe(true);
      });
    });

    describe('isSessionStreamToolCall', () => {
      it('should return true for session.stream.tool_call event', () => {
        const msg = createWSMessage('session.stream.tool_call', {
          sessionId: 's1',
          runId: 'r1',
          toolCall: {
            id: 'tc1',
            name: 'get_weather',
            arguments: { location: 'Berlin' },
          },
        });
        expect(isSessionStreamToolCall(msg)).toBe(true);
      });
    });

    describe('isSessionStreamUsage', () => {
      it('should return true for session.stream.usage event', () => {
        const msg = createWSMessage('session.stream.usage', {
          sessionId: 's1',
          runId: 'r1',
          usage: {
            promptTokens: 100,
            completionTokens: 50,
            totalTokens: 150,
          },
        });
        expect(isSessionStreamUsage(msg)).toBe(true);
      });
    });

    describe('isSessionStreamEnd', () => {
      it('should return true for session.stream.end event', () => {
        const msg = createWSMessage('session.stream.end', {
          sessionId: 's1',
          runId: 'r1',
          finishReason: 'stop',
        });
        expect(isSessionStreamEnd(msg)).toBe(true);
      });
    });

    describe('isSessionStreamError', () => {
      it('should return true for session.stream.error event', () => {
        const msg = createWSMessage('session.stream.error', {
          sessionId: 's1',
          runId: 'r1',
          error: {
            code: 'PROVIDER_ERROR',
            message: 'Provider unavailable',
          },
        });
        expect(isSessionStreamError(msg)).toBe(true);
      });
    });
  });

  // ============================================================================
  // Session Event Serialization Tests
  // ============================================================================

  describe('Session Event Serialization', () => {
    it('should serialize and deserialize session.created event', () => {
      const original = createWSMessage('session.created', {
        sessionId: 's1',
        agentId: 'a1',
        createdAt: new Date().toISOString(),
      });

      const json = JSON.stringify(original);
      const parsed = JSON.parse(json);

      expect(isSessionCreatedEvent(parsed)).toBe(true);
      expect(parsed.payload.sessionId).toBe('s1');
      expect(parsed.payload.agentId).toBe('a1');
    });

    it('should serialize and deserialize session.deleted event', () => {
      const original = createWSMessage('session.deleted', {
        sessionId: 's1',
        deletedAt: new Date().toISOString(),
      });

      const json = JSON.stringify(original);
      const parsed = JSON.parse(json);

      expect(isSessionDeletedEvent(parsed)).toBe(true);
      expect(parsed.payload.sessionId).toBe('s1');
    });

    it('should serialize and deserialize session.updated event', () => {
      const original = createWSMessage('session.updated', {
        sessionId: 's1',
        updates: { title: 'New Title', metadata: { key: 'value' } },
        updatedAt: new Date().toISOString(),
      });

      const json = JSON.stringify(original);
      const parsed = JSON.parse(json);

      expect(isSessionUpdatedEvent(parsed)).toBe(true);
      expect(parsed.payload.updates.title).toBe('New Title');
    });

    it('should serialize and deserialize session.stream.start event', () => {
      const original = createWSMessage('session.stream.start', {
        sessionId: 's1',
        runId: 'r1',
        agentId: 'a1',
        providerId: 'openai',
        modelId: 'gpt-4',
      });

      const json = JSON.stringify(original);
      const parsed = JSON.parse(json);

      expect(isSessionStreamStart(parsed)).toBe(true);
      expect(parsed.payload.providerId).toBe('openai');
      expect(parsed.payload.modelId).toBe('gpt-4');
    });

    it('should serialize and deserialize session.stream.delta event', () => {
      const original = createWSMessage('session.stream.delta', {
        sessionId: 's1',
        runId: 'r1',
        delta: ' World',
        content: 'Hello World',
      });

      const json = JSON.stringify(original);
      const parsed = JSON.parse(json);

      expect(isSessionStreamDelta(parsed)).toBe(true);
      expect(parsed.payload.delta).toBe(' World');
      expect(parsed.payload.content).toBe('Hello World');
    });

    it('should serialize and deserialize session.stream.error event', () => {
      const original = createWSMessage('session.stream.error', {
        sessionId: 's1',
        runId: 'r1',
        error: {
          code: 'RATE_LIMITED',
          message: 'Rate limit exceeded',
        },
      });

      const json = JSON.stringify(original);
      const parsed = JSON.parse(json);

      expect(isSessionStreamError(parsed)).toBe(true);
      expect(parsed.payload.error.code).toBe('RATE_LIMITED');
    });
  });

  // ============================================================================
  // Agent Event Type Guards Tests
  // ============================================================================

  describe('Agent Event Type Guards', () => {
    describe('isAgentEventType', () => {
      it('should return true for agent event types', () => {
        expect(isAgentEventType('agent.created')).toBe(true);
        expect(isAgentEventType('agent.updated')).toBe(true);
        expect(isAgentEventType('agent.deleted')).toBe(true);
        expect(isAgentEventType('agent.enabled')).toBe(true);
        expect(isAgentEventType('agent.disabled')).toBe(true);
      });

      it('should return false for non-agent event types', () => {
        expect(isAgentEventType('agent.list')).toBe(false);
        expect(isAgentEventType('agent.get')).toBe(false);
        expect(isAgentEventType('session.created')).toBe(false);
        expect(isAgentEventType('error')).toBe(false);
      });
    });

    describe('isAgentEvent', () => {
      it('should return true for agent.created event', () => {
        const msg = createWSMessage('agent.created', {
          agentId: 'a1',
          name: 'Test Agent',
          model: 'openai/gpt-4',
          createdAt: new Date().toISOString(),
        });
        expect(isAgentEvent(msg)).toBe(true);
      });

      it('should return true for agent.updated event', () => {
        const msg = createWSMessage('agent.updated', {
          agentId: 'a1',
          updates: { name: 'Updated Agent' },
          updatedAt: new Date().toISOString(),
        });
        expect(isAgentEvent(msg)).toBe(true);
      });

      it('should return true for agent.deleted event', () => {
        const msg = createWSMessage('agent.deleted', {
          agentId: 'a1',
          deletedAt: new Date().toISOString(),
        });
        expect(isAgentEvent(msg)).toBe(true);
      });

      it('should return true for agent.enabled event', () => {
        const msg = createWSMessage('agent.enabled', {
          agentId: 'a1',
          enabledAt: new Date().toISOString(),
        });
        expect(isAgentEvent(msg)).toBe(true);
      });

      it('should return true for agent.disabled event', () => {
        const msg = createWSMessage('agent.disabled', {
          agentId: 'a1',
          disabledAt: new Date().toISOString(),
        });
        expect(isAgentEvent(msg)).toBe(true);
      });

      it('should return false for non-agent events', () => {
        const msg = createWSMessage('session.created', {
          sessionId: 's1',
          agentId: 'a1',
          createdAt: new Date().toISOString(),
        });
        expect(isAgentEvent(msg)).toBe(false);
      });
    });

    describe('isAgentCreatedEvent', () => {
      it('should return true for agent.created event', () => {
        const msg = createWSMessage('agent.created', {
          agentId: 'a1',
          name: 'Test Agent',
          model: 'openai/gpt-4',
          createdAt: new Date().toISOString(),
        });
        expect(isAgentCreatedEvent(msg)).toBe(true);
      });

      it('should return false for other event types', () => {
        const msg = createWSMessage('agent.deleted', {
          agentId: 'a1',
          deletedAt: new Date().toISOString(),
        });
        expect(isAgentCreatedEvent(msg)).toBe(false);
      });
    });

    describe('isAgentUpdatedEvent', () => {
      it('should return true for agent.updated event', () => {
        const msg = createWSMessage('agent.updated', {
          agentId: 'a1',
          updates: { name: 'Updated Agent' },
          updatedAt: new Date().toISOString(),
        });
        expect(isAgentUpdatedEvent(msg)).toBe(true);
      });

      it('should return false for other event types', () => {
        const msg = createWSMessage('agent.created', {
          agentId: 'a1',
          name: 'Test Agent',
          model: 'openai/gpt-4',
          createdAt: new Date().toISOString(),
        });
        expect(isAgentUpdatedEvent(msg)).toBe(false);
      });
    });

    describe('isAgentDeletedEvent', () => {
      it('should return true for agent.deleted event', () => {
        const msg = createWSMessage('agent.deleted', {
          agentId: 'a1',
          deletedAt: new Date().toISOString(),
        });
        expect(isAgentDeletedEvent(msg)).toBe(true);
      });

      it('should return false for other event types', () => {
        const msg = createWSMessage('agent.created', {
          agentId: 'a1',
          name: 'Test Agent',
          model: 'openai/gpt-4',
          createdAt: new Date().toISOString(),
        });
        expect(isAgentDeletedEvent(msg)).toBe(false);
      });
    });

    describe('isAgentEnabledEvent', () => {
      it('should return true for agent.enabled event', () => {
        const msg = createWSMessage('agent.enabled', {
          agentId: 'a1',
          enabledAt: new Date().toISOString(),
        });
        expect(isAgentEnabledEvent(msg)).toBe(true);
      });

      it('should return false for other event types', () => {
        const msg = createWSMessage('agent.disabled', {
          agentId: 'a1',
          disabledAt: new Date().toISOString(),
        });
        expect(isAgentEnabledEvent(msg)).toBe(false);
      });
    });

    describe('isAgentDisabledEvent', () => {
      it('should return true for agent.disabled event', () => {
        const msg = createWSMessage('agent.disabled', {
          agentId: 'a1',
          disabledAt: new Date().toISOString(),
        });
        expect(isAgentDisabledEvent(msg)).toBe(true);
      });

      it('should return false for other event types', () => {
        const msg = createWSMessage('agent.enabled', {
          agentId: 'a1',
          enabledAt: new Date().toISOString(),
        });
        expect(isAgentDisabledEvent(msg)).toBe(false);
      });
    });
  });

  // ============================================================================
  // Agent Event Serialization Tests
  // ============================================================================

  describe('Agent Event Serialization', () => {
    it('should serialize and deserialize agent.created event', () => {
      const original = createWSMessage('agent.created', {
        agentId: 'a1',
        name: 'Test Agent',
        model: 'openai/gpt-4',
        createdAt: new Date().toISOString(),
      });

      const json = JSON.stringify(original);
      const parsed = JSON.parse(json);

      expect(isAgentCreatedEvent(parsed)).toBe(true);
      expect(parsed.payload.agentId).toBe('a1');
      expect(parsed.payload.name).toBe('Test Agent');
      expect(parsed.payload.model).toBe('openai/gpt-4');
    });

    it('should serialize and deserialize agent.updated event', () => {
      const original = createWSMessage('agent.updated', {
        agentId: 'a1',
        updates: { name: 'Updated Agent', model: 'anthropic/claude-3' },
        updatedAt: new Date().toISOString(),
      });

      const json = JSON.stringify(original);
      const parsed = JSON.parse(json);

      expect(isAgentUpdatedEvent(parsed)).toBe(true);
      expect(parsed.payload.updates.name).toBe('Updated Agent');
    });

    it('should serialize and deserialize agent.deleted event', () => {
      const original = createWSMessage('agent.deleted', {
        agentId: 'a1',
        deletedAt: new Date().toISOString(),
      });

      const json = JSON.stringify(original);
      const parsed = JSON.parse(json);

      expect(isAgentDeletedEvent(parsed)).toBe(true);
      expect(parsed.payload.agentId).toBe('a1');
    });

    it('should serialize and deserialize agent.enabled event', () => {
      const original = createWSMessage('agent.enabled', {
        agentId: 'a1',
        enabledAt: new Date().toISOString(),
      });

      const json = JSON.stringify(original);
      const parsed = JSON.parse(json);

      expect(isAgentEnabledEvent(parsed)).toBe(true);
      expect(parsed.payload.agentId).toBe('a1');
    });

    it('should serialize and deserialize agent.disabled event', () => {
      const original = createWSMessage('agent.disabled', {
        agentId: 'a1',
        disabledAt: new Date().toISOString(),
      });

      const json = JSON.stringify(original);
      const parsed = JSON.parse(json);

      expect(isAgentDisabledEvent(parsed)).toBe(true);
      expect(parsed.payload.agentId).toBe('a1');
    });
  });

  // ============================================================================
  // Provider Event Type Guards Tests
  // ============================================================================

  describe('Provider Event Type Guards', () => {
    describe('isProviderEventType', () => {
      it('should return true for provider event types', () => {
        expect(isProviderEventType('provider.registered')).toBe(true);
        expect(isProviderEventType('provider.updated')).toBe(true);
        expect(isProviderEventType('provider.unregistered')).toBe(true);
        expect(isProviderEventType('model.added')).toBe(true);
      });

      it('should return false for non-provider event types', () => {
        expect(isProviderEventType('provider.list')).toBe(false);
        expect(isProviderEventType('provider.models')).toBe(false);
        expect(isProviderEventType('agent.created')).toBe(false);
        expect(isProviderEventType('error')).toBe(false);
      });
    });

    describe('isProviderEvent', () => {
      it('should return true for provider.registered event', () => {
        const msg = createWSMessage('provider.registered', {
          providerId: 'openai',
          name: 'OpenAI',
          vendorFamily: 'openai',
          capabilities: ['chat', 'streaming'],
          registeredAt: new Date().toISOString(),
        });
        expect(isProviderEvent(msg)).toBe(true);
      });

      it('should return true for provider.updated event', () => {
        const msg = createWSMessage('provider.updated', {
          providerId: 'openai',
          updates: { enabled: true },
          updatedAt: new Date().toISOString(),
        });
        expect(isProviderEvent(msg)).toBe(true);
      });

      it('should return true for provider.unregistered event', () => {
        const msg = createWSMessage('provider.unregistered', {
          providerId: 'openai',
          unregisteredAt: new Date().toISOString(),
        });
        expect(isProviderEvent(msg)).toBe(true);
      });

      it('should return true for model.added event', () => {
        const msg = createWSMessage('model.added', {
          providerId: 'openai',
          modelId: 'gpt-4o',
          name: 'GPT-4o',
          capabilities: ['chat', 'streaming'],
          addedAt: new Date().toISOString(),
        });
        expect(isProviderEvent(msg)).toBe(true);
      });

      it('should return false for non-provider events', () => {
        const msg = createWSMessage('agent.created', {
          agentId: 'a1',
          name: 'Test Agent',
          model: 'openai/gpt-4',
          createdAt: new Date().toISOString(),
        });
        expect(isProviderEvent(msg)).toBe(false);
      });
    });

    describe('isProviderRegisteredEvent', () => {
      it('should return true for provider.registered event', () => {
        const msg = createWSMessage('provider.registered', {
          providerId: 'openai',
          name: 'OpenAI',
          vendorFamily: 'openai',
          capabilities: ['chat', 'streaming'],
          registeredAt: new Date().toISOString(),
        });
        expect(isProviderRegisteredEvent(msg)).toBe(true);
      });

      it('should return false for other event types', () => {
        const msg = createWSMessage('provider.unregistered', {
          providerId: 'openai',
          unregisteredAt: new Date().toISOString(),
        });
        expect(isProviderRegisteredEvent(msg)).toBe(false);
      });
    });

    describe('isProviderUpdatedEvent', () => {
      it('should return true for provider.updated event', () => {
        const msg = createWSMessage('provider.updated', {
          providerId: 'openai',
          updates: { enabled: true },
          updatedAt: new Date().toISOString(),
        });
        expect(isProviderUpdatedEvent(msg)).toBe(true);
      });

      it('should return false for other event types', () => {
        const msg = createWSMessage('provider.registered', {
          providerId: 'openai',
          name: 'OpenAI',
          vendorFamily: 'openai',
          capabilities: ['chat'],
          registeredAt: new Date().toISOString(),
        });
        expect(isProviderUpdatedEvent(msg)).toBe(false);
      });
    });

    describe('isProviderUnregisteredEvent', () => {
      it('should return true for provider.unregistered event', () => {
        const msg = createWSMessage('provider.unregistered', {
          providerId: 'openai',
          unregisteredAt: new Date().toISOString(),
        });
        expect(isProviderUnregisteredEvent(msg)).toBe(true);
      });

      it('should return false for other event types', () => {
        const msg = createWSMessage('provider.updated', {
          providerId: 'openai',
          updates: {},
          updatedAt: new Date().toISOString(),
        });
        expect(isProviderUnregisteredEvent(msg)).toBe(false);
      });
    });

    describe('isModelAddedEvent', () => {
      it('should return true for model.added event', () => {
        const msg = createWSMessage('model.added', {
          providerId: 'openai',
          modelId: 'gpt-4o',
          name: 'GPT-4o',
          capabilities: ['chat', 'streaming'],
          addedAt: new Date().toISOString(),
        });
        expect(isModelAddedEvent(msg)).toBe(true);
      });

      it('should return true for model.added event without capabilities', () => {
        const msg = createWSMessage('model.added', {
          providerId: 'openai',
          modelId: 'gpt-4o',
          name: 'GPT-4o',
          addedAt: new Date().toISOString(),
        });
        expect(isModelAddedEvent(msg)).toBe(true);
      });

      it('should return false for other event types', () => {
        const msg = createWSMessage('provider.registered', {
          providerId: 'openai',
          name: 'OpenAI',
          vendorFamily: 'openai',
          capabilities: ['chat'],
          registeredAt: new Date().toISOString(),
        });
        expect(isModelAddedEvent(msg)).toBe(false);
      });
    });
  });

  // ============================================================================
  // Provider Event Serialization Tests
  // ============================================================================

  describe('Provider Event Serialization', () => {
    it('should serialize and deserialize provider.registered event', () => {
      const original = createWSMessage('provider.registered', {
        providerId: 'openai',
        name: 'OpenAI',
        vendorFamily: 'openai',
        capabilities: ['chat', 'streaming'],
        registeredAt: new Date().toISOString(),
      });

      const json = JSON.stringify(original);
      const parsed = JSON.parse(json);

      expect(isProviderRegisteredEvent(parsed)).toBe(true);
      expect(parsed.payload.providerId).toBe('openai');
      expect(parsed.payload.name).toBe('OpenAI');
      expect(parsed.payload.capabilities).toContain('chat');
    });

    it('should serialize and deserialize provider.updated event', () => {
      const original = createWSMessage('provider.updated', {
        providerId: 'openai',
        updates: { enabled: false, priority: 10 },
        updatedAt: new Date().toISOString(),
      });

      const json = JSON.stringify(original);
      const parsed = JSON.parse(json);

      expect(isProviderUpdatedEvent(parsed)).toBe(true);
      expect(parsed.payload.updates.enabled).toBe(false);
    });

    it('should serialize and deserialize provider.unregistered event', () => {
      const original = createWSMessage('provider.unregistered', {
        providerId: 'openai',
        unregisteredAt: new Date().toISOString(),
      });

      const json = JSON.stringify(original);
      const parsed = JSON.parse(json);

      expect(isProviderUnregisteredEvent(parsed)).toBe(true);
      expect(parsed.payload.providerId).toBe('openai');
    });

    it('should serialize and deserialize model.added event', () => {
      const original = createWSMessage('model.added', {
        providerId: 'openai',
        modelId: 'gpt-4o',
        name: 'GPT-4o',
        capabilities: ['chat', 'streaming'],
        addedAt: new Date().toISOString(),
      });

      const json = JSON.stringify(original);
      const parsed = JSON.parse(json);

      expect(isModelAddedEvent(parsed)).toBe(true);
      expect(parsed.payload.providerId).toBe('openai');
      expect(parsed.payload.modelId).toBe('gpt-4o');
      expect(parsed.payload.capabilities).toContain('chat');
    });

    it('should serialize and deserialize model.added event without capabilities', () => {
      const original = createWSMessage('model.added', {
        providerId: 'anthropic',
        modelId: 'claude-3',
        name: 'Claude 3',
        addedAt: new Date().toISOString(),
      });

      const json = JSON.stringify(original);
      const parsed = JSON.parse(json);

      expect(isModelAddedEvent(parsed)).toBe(true);
      expect(parsed.payload.providerId).toBe('anthropic');
      expect(parsed.payload.modelId).toBe('claude-3');
    });
  });

  // ============================================================================
  // Node Event Type Guards Tests
  // ============================================================================

  describe('Node Event Type Guards', () => {
    describe('isNodeEventType', () => {
      it('should return true for node event types', () => {
        expect(isNodeEventType('node.registered')).toBe(true);
        expect(isNodeEventType('node.online')).toBe(true);
        expect(isNodeEventType('node.offline')).toBe(true);
        expect(isNodeEventType('node.invoked')).toBe(true);
        expect(isNodeEventType('node.updated')).toBe(true);
        expect(isNodeEventType('node.unregistered')).toBe(true);
      });

      it('should return false for non-node event types', () => {
        expect(isNodeEventType('node.list')).toBe(false);
        expect(isNodeEventType('node.describe')).toBe(false);
        expect(isNodeEventType('agent.created')).toBe(false);
        expect(isNodeEventType('error')).toBe(false);
      });
    });

    describe('isNodeEvent', () => {
      it('should return true for node.registered event', () => {
        const msg = createWSMessage('node.registered', {
          nodeId: 'n1',
          name: 'Test Node',
          type: 'mobile',
          capabilities: ['camera', 'microphone'],
          registeredAt: new Date().toISOString(),
        });
        expect(isNodeEvent(msg)).toBe(true);
      });

      it('should return true for node.online event', () => {
        const msg = createWSMessage('node.online', {
          nodeId: 'n1',
          capabilities: ['camera'],
          onlineAt: new Date().toISOString(),
        });
        expect(isNodeEvent(msg)).toBe(true);
      });

      it('should return true for node.offline event', () => {
        const msg = createWSMessage('node.offline', {
          nodeId: 'n1',
          offlineAt: new Date().toISOString(),
        });
        expect(isNodeEvent(msg)).toBe(true);
      });

      it('should return true for node.invoked event', () => {
        const msg = createWSMessage('node.invoked', {
          nodeId: 'n1',
          capability: 'camera',
          params: { action: 'capture' },
          invokedAt: new Date().toISOString(),
        });
        expect(isNodeEvent(msg)).toBe(true);
      });

      it('should return true for node.updated event', () => {
        const msg = createWSMessage('node.updated', {
          nodeId: 'n1',
          updates: { name: 'Updated Node' },
          updatedAt: new Date().toISOString(),
        });
        expect(isNodeEvent(msg)).toBe(true);
      });

      it('should return true for node.unregistered event', () => {
        const msg = createWSMessage('node.unregistered', {
          nodeId: 'n1',
          unregisteredAt: new Date().toISOString(),
        });
        expect(isNodeEvent(msg)).toBe(true);
      });

      it('should return false for non-node events', () => {
        const msg = createWSMessage('agent.created', {
          agentId: 'a1',
          name: 'Test Agent',
          model: 'openai/gpt-4',
          createdAt: new Date().toISOString(),
        });
        expect(isNodeEvent(msg)).toBe(false);
      });
    });

    describe('isNodeRegisteredEvent', () => {
      it('should return true for node.registered event', () => {
        const msg = createWSMessage('node.registered', {
          nodeId: 'n1',
          name: 'Test Node',
          type: 'mobile',
          capabilities: ['camera'],
          registeredAt: new Date().toISOString(),
        });
        expect(isNodeRegisteredEvent(msg)).toBe(true);
      });

      it('should return false for other event types', () => {
        const msg = createWSMessage('node.unregistered', {
          nodeId: 'n1',
          unregisteredAt: new Date().toISOString(),
        });
        expect(isNodeRegisteredEvent(msg)).toBe(false);
      });
    });

    describe('isNodeOnlineEvent', () => {
      it('should return true for node.online event', () => {
        const msg = createWSMessage('node.online', {
          nodeId: 'n1',
          capabilities: ['camera'],
          onlineAt: new Date().toISOString(),
        });
        expect(isNodeOnlineEvent(msg)).toBe(true);
      });

      it('should return true for node.online event with metadata', () => {
        const msg = createWSMessage('node.online', {
          nodeId: 'n1',
          capabilities: ['camera'],
          metadata: { version: '1.0' },
          onlineAt: new Date().toISOString(),
        });
        expect(isNodeOnlineEvent(msg)).toBe(true);
      });

      it('should return false for other event types', () => {
        const msg = createWSMessage('node.offline', {
          nodeId: 'n1',
          offlineAt: new Date().toISOString(),
        });
        expect(isNodeOnlineEvent(msg)).toBe(false);
      });
    });

    describe('isNodeOfflineEvent', () => {
      it('should return true for node.offline event', () => {
        const msg = createWSMessage('node.offline', {
          nodeId: 'n1',
          offlineAt: new Date().toISOString(),
        });
        expect(isNodeOfflineEvent(msg)).toBe(true);
      });

      it('should return false for other event types', () => {
        const msg = createWSMessage('node.online', {
          nodeId: 'n1',
          capabilities: ['camera'],
          onlineAt: new Date().toISOString(),
        });
        expect(isNodeOfflineEvent(msg)).toBe(false);
      });
    });

    describe('isNodeInvokedEvent', () => {
      it('should return true for node.invoked event', () => {
        const msg = createWSMessage('node.invoked', {
          nodeId: 'n1',
          capability: 'camera',
          params: { action: 'capture' },
          invokedAt: new Date().toISOString(),
        });
        expect(isNodeInvokedEvent(msg)).toBe(true);
      });

      it('should return true for node.invoked event with result', () => {
        const msg = createWSMessage('node.invoked', {
          nodeId: 'n1',
          capability: 'camera',
          params: {},
          result: { success: true },
          invokedAt: new Date().toISOString(),
        });
        expect(isNodeInvokedEvent(msg)).toBe(true);
      });

      it('should return true for node.invoked event with error', () => {
        const msg = createWSMessage('node.invoked', {
          nodeId: 'n1',
          capability: 'camera',
          params: {},
          error: { code: 'CAPTURE_FAILED', message: 'Capture failed' },
          invokedAt: new Date().toISOString(),
        });
        expect(isNodeInvokedEvent(msg)).toBe(true);
      });

      it('should return false for other event types', () => {
        const msg = createWSMessage('node.registered', {
          nodeId: 'n1',
          name: 'Test Node',
          type: 'mobile',
          capabilities: [],
          registeredAt: new Date().toISOString(),
        });
        expect(isNodeInvokedEvent(msg)).toBe(false);
      });
    });

    describe('isNodeUpdatedEvent', () => {
      it('should return true for node.updated event', () => {
        const msg = createWSMessage('node.updated', {
          nodeId: 'n1',
          updates: { name: 'Updated Node' },
          updatedAt: new Date().toISOString(),
        });
        expect(isNodeUpdatedEvent(msg)).toBe(true);
      });

      it('should return false for other event types', () => {
        const msg = createWSMessage('node.registered', {
          nodeId: 'n1',
          name: 'Test Node',
          type: 'mobile',
          capabilities: [],
          registeredAt: new Date().toISOString(),
        });
        expect(isNodeUpdatedEvent(msg)).toBe(false);
      });
    });

    describe('isNodeUnregisteredEvent', () => {
      it('should return true for node.unregistered event', () => {
        const msg = createWSMessage('node.unregistered', {
          nodeId: 'n1',
          unregisteredAt: new Date().toISOString(),
        });
        expect(isNodeUnregisteredEvent(msg)).toBe(true);
      });

      it('should return false for other event types', () => {
        const msg = createWSMessage('node.registered', {
          nodeId: 'n1',
          name: 'Test Node',
          type: 'mobile',
          capabilities: [],
          registeredAt: new Date().toISOString(),
        });
        expect(isNodeUnregisteredEvent(msg)).toBe(false);
      });
    });
  });

  // ============================================================================
  // Node Event Serialization Tests
  // ============================================================================

  describe('Node Event Serialization', () => {
    it('should serialize and deserialize node.registered event', () => {
      const original = createWSMessage('node.registered', {
        nodeId: 'n1',
        name: 'Test Node',
        type: 'mobile',
        capabilities: ['camera', 'microphone'],
        registeredAt: new Date().toISOString(),
      });

      const json = JSON.stringify(original);
      const parsed = JSON.parse(json);

      expect(isNodeRegisteredEvent(parsed)).toBe(true);
      expect(parsed.payload.nodeId).toBe('n1');
      expect(parsed.payload.name).toBe('Test Node');
      expect(parsed.payload.type).toBe('mobile');
      expect(parsed.payload.capabilities).toContain('camera');
    });

    it('should serialize and deserialize node.online event', () => {
      const original = createWSMessage('node.online', {
        nodeId: 'n1',
        capabilities: ['camera'],
        metadata: { version: '1.0' },
        onlineAt: new Date().toISOString(),
      });

      const json = JSON.stringify(original);
      const parsed = JSON.parse(json);

      expect(isNodeOnlineEvent(parsed)).toBe(true);
      expect(parsed.payload.nodeId).toBe('n1');
      expect(parsed.payload.metadata?.version).toBe('1.0');
    });

    it('should serialize and deserialize node.offline event', () => {
      const original = createWSMessage('node.offline', {
        nodeId: 'n1',
        offlineAt: new Date().toISOString(),
      });

      const json = JSON.stringify(original);
      const parsed = JSON.parse(json);

      expect(isNodeOfflineEvent(parsed)).toBe(true);
      expect(parsed.payload.nodeId).toBe('n1');
    });

    it('should serialize and deserialize node.invoked event with result', () => {
      const original = createWSMessage('node.invoked', {
        nodeId: 'n1',
        capability: 'camera',
        params: { action: 'capture' },
        result: { success: true, imageId: 'img-123' },
        invokedAt: new Date().toISOString(),
      });

      const json = JSON.stringify(original);
      const parsed = JSON.parse(json);

      expect(isNodeInvokedEvent(parsed)).toBe(true);
      expect(parsed.payload.capability).toBe('camera');
      expect((parsed.payload.result as { success: boolean }).success).toBe(true);
    });

    it('should serialize and deserialize node.invoked event with error', () => {
      const original = createWSMessage('node.invoked', {
        nodeId: 'n1',
        capability: 'camera',
        params: {},
        error: { code: 'CAPTURE_FAILED', message: 'Camera not available' },
        invokedAt: new Date().toISOString(),
      });

      const json = JSON.stringify(original);
      const parsed = JSON.parse(json);

      expect(isNodeInvokedEvent(parsed)).toBe(true);
      expect(parsed.payload.error?.code).toBe('CAPTURE_FAILED');
    });

    it('should serialize and deserialize node.updated event', () => {
      const original = createWSMessage('node.updated', {
        nodeId: 'n1',
        updates: { name: 'Updated Node', capabilities: ['camera', 'gps'] },
        updatedAt: new Date().toISOString(),
      });

      const json = JSON.stringify(original);
      const parsed = JSON.parse(json);

      expect(isNodeUpdatedEvent(parsed)).toBe(true);
      expect(parsed.payload.updates.name).toBe('Updated Node');
    });

    it('should serialize and deserialize node.unregistered event', () => {
      const original = createWSMessage('node.unregistered', {
        nodeId: 'n1',
        unregisteredAt: new Date().toISOString(),
      });

      const json = JSON.stringify(original);
      const parsed = JSON.parse(json);

      expect(isNodeUnregisteredEvent(parsed)).toBe(true);
      expect(parsed.payload.nodeId).toBe('n1');
    });
  });

  // ============================================================================
  // Pairing Event Type Guards Tests
  // ============================================================================

  describe('Pairing Event Type Guards', () => {
    describe('isPairingEventType', () => {
      it('should return true for pairing event types', () => {
        expect(isPairingEventType('pairing.requested')).toBe(true);
        expect(isPairingEventType('pairing.approved')).toBe(true);
        expect(isPairingEventType('pairing.denied')).toBe(true);
      });

      it('should return false for non-pairing event types', () => {
        expect(isPairingEventType('pairing.request')).toBe(false);
        expect(isPairingEventType('pairing.approve')).toBe(false);
        expect(isPairingEventType('node.registered')).toBe(false);
        expect(isPairingEventType('error')).toBe(false);
      });
    });

    describe('isPairingEvent', () => {
      it('should return true for pairing.requested event', () => {
        const msg = createWSMessage('pairing.requested', {
          requestId: 'req-1',
          pairingCode: '123456',
          deviceName: 'Test Device',
          deviceType: 'mobile',
          capabilities: ['camera'],
          requestedAt: new Date().toISOString(),
        });
        expect(isPairingEvent(msg)).toBe(true);
      });

      it('should return true for pairing.approved event', () => {
        const msg = createWSMessage('pairing.approved', {
          requestId: 'req-1',
          nodeId: 'n1',
          token: 'token-abc123',
          scopes: ['camera', 'microphone'],
          approvedAt: new Date().toISOString(),
        });
        expect(isPairingEvent(msg)).toBe(true);
      });

      it('should return true for pairing.denied event', () => {
        const msg = createWSMessage('pairing.denied', {
          requestId: 'req-1',
          deniedAt: new Date().toISOString(),
        });
        expect(isPairingEvent(msg)).toBe(true);
      });

      it('should return false for non-pairing events', () => {
        const msg = createWSMessage('node.registered', {
          nodeId: 'n1',
          name: 'Test Node',
          type: 'mobile',
          capabilities: [],
          registeredAt: new Date().toISOString(),
        });
        expect(isPairingEvent(msg)).toBe(false);
      });
    });

    describe('isPairingRequestedEvent', () => {
      it('should return true for pairing.requested event', () => {
        const msg = createWSMessage('pairing.requested', {
          requestId: 'req-1',
          pairingCode: '123456',
          deviceName: 'Test Device',
          deviceType: 'mobile',
          capabilities: ['camera'],
          requestedAt: new Date().toISOString(),
        });
        expect(isPairingRequestedEvent(msg)).toBe(true);
      });

      it('should return false for other event types', () => {
        const msg = createWSMessage('pairing.approved', {
          requestId: 'req-1',
          nodeId: 'n1',
          token: 'token-abc',
          scopes: [],
          approvedAt: new Date().toISOString(),
        });
        expect(isPairingRequestedEvent(msg)).toBe(false);
      });
    });

    describe('isPairingApprovedEvent', () => {
      it('should return true for pairing.approved event', () => {
        const msg = createWSMessage('pairing.approved', {
          requestId: 'req-1',
          nodeId: 'n1',
          token: 'token-abc123',
          scopes: ['camera'],
          approvedAt: new Date().toISOString(),
        });
        expect(isPairingApprovedEvent(msg)).toBe(true);
      });

      it('should return false for other event types', () => {
        const msg = createWSMessage('pairing.denied', {
          requestId: 'req-1',
          deniedAt: new Date().toISOString(),
        });
        expect(isPairingApprovedEvent(msg)).toBe(false);
      });
    });

    describe('isPairingDeniedEvent', () => {
      it('should return true for pairing.denied event', () => {
        const msg = createWSMessage('pairing.denied', {
          requestId: 'req-1',
          deniedAt: new Date().toISOString(),
        });
        expect(isPairingDeniedEvent(msg)).toBe(true);
      });

      it('should return false for other event types', () => {
        const msg = createWSMessage('pairing.approved', {
          requestId: 'req-1',
          nodeId: 'n1',
          token: 'token-abc',
          scopes: [],
          approvedAt: new Date().toISOString(),
        });
        expect(isPairingDeniedEvent(msg)).toBe(false);
      });
    });
  });

  // ============================================================================
  // Pairing Event Serialization Tests
  // ============================================================================

  describe('Pairing Event Serialization', () => {
    it('should serialize and deserialize pairing.requested event', () => {
      const original = createWSMessage('pairing.requested', {
        requestId: 'req-1',
        pairingCode: '123456',
        deviceName: 'Test Device',
        deviceType: 'mobile',
        capabilities: ['camera', 'microphone'],
        requestedAt: new Date().toISOString(),
      });

      const json = JSON.stringify(original);
      const parsed = JSON.parse(json);

      expect(isPairingRequestedEvent(parsed)).toBe(true);
      expect(parsed.payload.requestId).toBe('req-1');
      expect(parsed.payload.pairingCode).toBe('123456');
      expect(parsed.payload.deviceName).toBe('Test Device');
      expect(parsed.payload.capabilities).toContain('camera');
    });

    it('should serialize and deserialize pairing.approved event', () => {
      const original = createWSMessage('pairing.approved', {
        requestId: 'req-1',
        nodeId: 'n1',
        token: 'token-abc123',
        scopes: ['camera', 'microphone'],
        approvedAt: new Date().toISOString(),
      });

      const json = JSON.stringify(original);
      const parsed = JSON.parse(json);

      expect(isPairingApprovedEvent(parsed)).toBe(true);
      expect(parsed.payload.requestId).toBe('req-1');
      expect(parsed.payload.nodeId).toBe('n1');
      expect(parsed.payload.token).toBe('token-abc123');
      expect(parsed.payload.scopes).toContain('camera');
    });

    it('should serialize and deserialize pairing.denied event', () => {
      const original = createWSMessage('pairing.denied', {
        requestId: 'req-1',
        deniedAt: new Date().toISOString(),
      });

      const json = JSON.stringify(original);
      const parsed = JSON.parse(json);

      expect(isPairingDeniedEvent(parsed)).toBe(true);
      expect(parsed.payload.requestId).toBe('req-1');
    });
  });
});

// ============================================================================
// Configuration Event Tests
// ============================================================================

describe('Configuration Events', () => {
  describe('isConfigEventType', () => {
    it('should return true for valid config event types', () => {
      expect(isConfigEventType('config.updated')).toBe(true);
      expect(isConfigEventType('config.reloaded')).toBe(true);
      expect(isConfigEventType('config.validation_error')).toBe(true);
    });

    it('should return false for invalid config event types', () => {
      expect(isConfigEventType('config.get')).toBe(false);
      expect(isConfigEventType('config.update')).toBe(false);
      expect(isConfigEventType('node.registered')).toBe(false);
      expect(isConfigEventType('error')).toBe(false);
    });
  });

  describe('isConfigEvent', () => {
    it('should return true for valid ConfigUpdatedEvent', () => {
      const msg = createWSMessage('config.updated', {
        updates: { 'app.name': 'NewName' },
        updatedAt: new Date().toISOString(),
      });

      expect(isConfigEvent(msg)).toBe(true);
    });

    it('should return true for valid ConfigReloadedEvent', () => {
      const msg = createWSMessage('config.reloaded', {
        config: { app: { name: 'TestApp' } },
        reloadedAt: new Date().toISOString(),
      });

      expect(isConfigEvent(msg)).toBe(true);
    });

    it('should return true for valid ConfigValidationErrorEvent', () => {
      const msg = createWSMessage('config.validation_error', {
        errors: ['Invalid value for field "port"'],
        occurredAt: new Date().toISOString(),
      });

      expect(isConfigEvent(msg)).toBe(true);
    });

    it('should return false for non-config messages', () => {
      const msg = createWSMessage('node.registered', {
        nodeId: 'node-1',
        name: 'Test',
        type: 'mobile',
        capabilities: [],
        registeredAt: new Date().toISOString(),
      });

      expect(isConfigEvent(msg)).toBe(false);
    });
  });

  describe('isConfigUpdatedEvent', () => {
    it('should return true for ConfigUpdatedEvent', () => {
      const msg = createWSMessage('config.updated', {
        updates: { 'app.name': 'NewName' },
        updatedAt: new Date().toISOString(),
        updatedBy: 'admin',
      });

      expect(isConfigUpdatedEvent(msg)).toBe(true);
    });

    it('should return false for other message types', () => {
      const msg = createWSMessage('config.reloaded', {
        config: {},
        reloadedAt: new Date().toISOString(),
      });

      expect(isConfigUpdatedEvent(msg)).toBe(false);
    });
  });

  describe('isConfigReloadedEvent', () => {
    it('should return true for ConfigReloadedEvent', () => {
      const msg = createWSMessage('config.reloaded', {
        config: { app: { name: 'ReloadedApp' } },
        reloadedAt: new Date().toISOString(),
      });

      expect(isConfigReloadedEvent(msg)).toBe(true);
    });

    it('should return false for other message types', () => {
      const msg = createWSMessage('config.updated', {
        updates: {},
        updatedAt: new Date().toISOString(),
      });

      expect(isConfigReloadedEvent(msg)).toBe(false);
    });
  });

  describe('isConfigValidationErrorEvent', () => {
    it('should return true for ConfigValidationErrorEvent', () => {
      const msg = createWSMessage('config.validation_error', {
        errors: ['Field "port" must be a number'],
        occurredAt: new Date().toISOString(),
      });

      expect(isConfigValidationErrorEvent(msg)).toBe(true);
    });

    it('should return false for other message types', () => {
      const msg = createWSMessage('config.updated', {
        updates: {},
        updatedAt: new Date().toISOString(),
      });

      expect(isConfigValidationErrorEvent(msg)).toBe(false);
    });
  });

  describe('Config Event Serialization', () => {
    it('should serialize and deserialize ConfigUpdatedEvent', () => {
      const original = createWSMessage('config.updated', {
        updates: { 'app.name': 'NewName', 'app.version': '2.0.0' },
        updatedAt: '2024-01-15T10:30:00.000Z',
        updatedBy: 'admin-user',
      });

      const json = JSON.stringify(original);
      const parsed = JSON.parse(json);

      expect(isConfigUpdatedEvent(parsed)).toBe(true);
      expect(parsed.payload.updates).toEqual({ 'app.name': 'NewName', 'app.version': '2.0.0' });
      expect(parsed.payload.updatedBy).toBe('admin-user');
    });

    it('should serialize and deserialize ConfigReloadedEvent', () => {
      const original = createWSMessage('config.reloaded', {
        config: { app: { name: 'TestApp', version: '1.0.0' } },
        reloadedAt: '2024-01-15T11:00:00.000Z',
      });

      const json = JSON.stringify(original);
      const parsed = JSON.parse(json);

      expect(isConfigReloadedEvent(parsed)).toBe(true);
      expect(parsed.payload.config).toEqual({ app: { name: 'TestApp', version: '1.0.0' } });
    });

    it('should serialize and deserialize ConfigValidationErrorEvent', () => {
      const original = createWSMessage('config.validation_error', {
        errors: [
          'Field "port" must be a number',
          'Field "host" is required',
        ],
        occurredAt: '2024-01-15T11:05:00.000Z',
      });

      const json = JSON.stringify(original);
      const parsed = JSON.parse(json);

      expect(isConfigValidationErrorEvent(parsed)).toBe(true);
      expect(parsed.payload.errors).toHaveLength(2);
    });
  });
});

// ============================================================================
// Presence Event Type Guards Tests
// ============================================================================

describe('Presence Event Types', () => {
  describe('isPresenceEventType', () => {
    it('should return true for presence event types', () => {
      expect(isPresenceEventType('presence.changed')).toBe(true);
      expect(isPresenceEventType('presence.online')).toBe(true);
      expect(isPresenceEventType('presence.offline')).toBe(true);
      expect(isPresenceEventType('presence.subscribed')).toBe(true);
      expect(isPresenceEventType('presence.unsubscribed')).toBe(true);
    });

    it('should return false for non-presence event types', () => {
      expect(isPresenceEventType('config.updated')).toBe(false);
      expect(isPresenceEventType('session.created')).toBe(false);
      expect(isPresenceEventType('node.online')).toBe(false);
    });
  });

  describe('isPresenceEvent', () => {
    it('should return true for PresenceChangedEvent', () => {
      const msg = createWSMessage('presence.changed', {
        clientId: 'client-123',
        status: 'online' as PresenceStatus,
      });

      expect(isPresenceEvent(msg)).toBe(true);
    });

    it('should return true for PresenceOnlineEvent', () => {
      const msg = createWSMessage('presence.online', {
        clientId: 'client-123',
        onlineAt: new Date().toISOString(),
      });

      expect(isPresenceEvent(msg)).toBe(true);
    });

    it('should return false for non-presence events', () => {
      const msg = createWSMessage('config.updated', {
        updates: {},
        updatedAt: new Date().toISOString(),
      });

      expect(isPresenceEvent(msg)).toBe(false);
    });
  });

  describe('isPresenceChangedEvent', () => {
    it('should return true for PresenceChangedEvent', () => {
      const msg = createWSMessage('presence.changed', {
        clientId: 'client-123',
        status: 'online' as PresenceStatus,
        metadata: { device: 'mobile' },
      });

      expect(isPresenceChangedEvent(msg)).toBe(true);
    });

    it('should return false for other message types', () => {
      const msg = createWSMessage('presence.online', {
        clientId: 'client-123',
        onlineAt: new Date().toISOString(),
      });

      expect(isPresenceChangedEvent(msg)).toBe(false);
    });
  });

  describe('isPresenceOnlineEvent', () => {
    it('should return true for PresenceOnlineEvent', () => {
      const msg = createWSMessage('presence.online', {
        clientId: 'client-123',
        connectionId: 'conn-456',
        onlineAt: new Date().toISOString(),
      });

      expect(isPresenceOnlineEvent(msg)).toBe(true);
    });

    it('should return false for other message types', () => {
      const msg = createWSMessage('presence.changed', {
        clientId: 'client-123',
        status: 'online' as PresenceStatus,
      });

      expect(isPresenceOnlineEvent(msg)).toBe(false);
    });
  });

  describe('isPresenceOfflineEvent', () => {
    it('should return true for PresenceOfflineEvent', () => {
      const msg = createWSMessage('presence.offline', {
        clientId: 'client-123',
        connectionId: 'conn-456',
        offlineAt: new Date().toISOString(),
        reason: 'disconnect',
      });

      expect(isPresenceOfflineEvent(msg)).toBe(true);
    });

    it('should return false for other message types', () => {
      const msg = createWSMessage('presence.online', {
        clientId: 'client-123',
        onlineAt: new Date().toISOString(),
      });

      expect(isPresenceOfflineEvent(msg)).toBe(false);
    });
  });

  describe('isPresenceSubscribedEvent', () => {
    it('should return true for PresenceSubscribedEvent', () => {
      const msg = createWSMessage('presence.subscribed', {
        connectionId: 'conn-456',
        subscribedAt: new Date().toISOString(),
      });

      expect(isPresenceSubscribedEvent(msg)).toBe(true);
    });

    it('should return false for other message types', () => {
      const msg = createWSMessage('presence.unsubscribed', {
        connectionId: 'conn-456',
        unsubscribedAt: new Date().toISOString(),
      });

      expect(isPresenceSubscribedEvent(msg)).toBe(false);
    });
  });

  describe('isPresenceUnsubscribedEvent', () => {
    it('should return true for PresenceUnsubscribedEvent', () => {
      const msg = createWSMessage('presence.unsubscribed', {
        connectionId: 'conn-456',
        unsubscribedAt: new Date().toISOString(),
      });

      expect(isPresenceUnsubscribedEvent(msg)).toBe(true);
    });

    it('should return false for other message types', () => {
      const msg = createWSMessage('presence.subscribed', {
        connectionId: 'conn-456',
        subscribedAt: new Date().toISOString(),
      });

      expect(isPresenceUnsubscribedEvent(msg)).toBe(false);
    });
  });

  describe('Presence Event Serialization', () => {
    it('should serialize and deserialize PresenceChangedEvent', () => {
      const original = createWSMessage('presence.changed', {
        clientId: 'client-789',
        status: 'away' as PresenceStatus,
        metadata: { lastActive: '2024-01-15T10:00:00.000Z' },
      });

      const json = JSON.stringify(original);
      const parsed = JSON.parse(json);

      expect(isPresenceChangedEvent(parsed)).toBe(true);
      expect(parsed.payload.clientId).toBe('client-789');
      expect(parsed.payload.status).toBe('away');
    });

    it('should serialize and deserialize PresenceOnlineEvent', () => {
      const original = createWSMessage('presence.online', {
        clientId: 'client-789',
        connectionId: 'conn-111',
        metadata: { device: 'desktop' },
        onlineAt: '2024-01-15T09:00:00.000Z',
      });

      const json = JSON.stringify(original);
      const parsed = JSON.parse(json);

      expect(isPresenceOnlineEvent(parsed)).toBe(true);
      expect(parsed.payload.clientId).toBe('client-789');
      expect(parsed.payload.connectionId).toBe('conn-111');
    });

    it('should serialize and deserialize PresenceOfflineEvent', () => {
      const original = createWSMessage('presence.offline', {
        clientId: 'client-789',
        connectionId: 'conn-111',
        offlineAt: '2024-01-15T10:00:00.000Z',
        reason: 'timeout',
      });

      const json = JSON.stringify(original);
      const parsed = JSON.parse(json);

      expect(isPresenceOfflineEvent(parsed)).toBe(true);
      expect(parsed.payload.reason).toBe('timeout');
    });

    it('should serialize and deserialize PresenceSubscribedEvent', () => {
      const original = createWSMessage('presence.subscribed', {
        connectionId: 'conn-222',
        subscribedAt: '2024-01-15T08:30:00.000Z',
      });

      const json = JSON.stringify(original);
      const parsed = JSON.parse(json);

      expect(isPresenceSubscribedEvent(parsed)).toBe(true);
      expect(parsed.payload.connectionId).toBe('conn-222');
    });

    it('should serialize and deserialize PresenceUnsubscribedEvent', () => {
      const original = createWSMessage('presence.unsubscribed', {
        connectionId: 'conn-222',
        unsubscribedAt: '2024-01-15T09:00:00.000Z',
      });

      const json = JSON.stringify(original);
      const parsed = JSON.parse(json);

      expect(isPresenceUnsubscribedEvent(parsed)).toBe(true);
      expect(parsed.payload.connectionId).toBe('conn-222');
    });
  });
});
