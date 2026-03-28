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
});
