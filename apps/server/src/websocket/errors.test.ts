import { describe, it, expect, beforeEach } from 'vitest';
import {
  WSErrorHandler,
  createWSErrorResponse,
  createWSErrorObj,
  WSErrorClass,
  ERROR_MESSAGES,
} from './errors';
import { WS_ERROR_CODES, type WSError } from '@openaidy/shared-types';

// Mock logger
const mockLogger = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => mockLogger,
};

describe('errors', () => {
  describe('ERROR_MESSAGES', () => {
    it('should have messages for all error codes', () => {
      const codes = Object.values(WS_ERROR_CODES);
      for (const code of codes) {
        expect(ERROR_MESSAGES[code as keyof typeof ERROR_MESSAGES]).toBeDefined();
        expect(typeof ERROR_MESSAGES[code as keyof typeof ERROR_MESSAGES]).toBe('string');
      }
    });
  });

  describe('WSErrorHandler', () => {
    let handler: WSErrorHandler;

    beforeEach(() => {
      handler = new WSErrorHandler(mockLogger as any);
    });

    describe('createError', () => {
      it('should create a WSError with code and default message', () => {
        const error = handler.createError(WS_ERROR_CODES.AUTH_FAILED);

        expect(error.code).toBe(WS_ERROR_CODES.AUTH_FAILED);
        expect(error.message).toBe(ERROR_MESSAGES.AUTH_FAILED);
        expect(error.details).toBeUndefined();
      });

      it('should create a WSError with custom message', () => {
        const error = handler.createError(
          WS_ERROR_CODES.AUTH_FAILED,
          'Custom error message',
        );

        expect(error.code).toBe(WS_ERROR_CODES.AUTH_FAILED);
        expect(error.message).toBe('Custom error message');
      });

      it('should create a WSError with details', () => {
        const error = handler.createError(
          WS_ERROR_CODES.INVALID_PAYLOAD,
          'Validation failed',
          { field: 'sessionId', reason: 'required' },
        );

        expect(error.code).toBe(WS_ERROR_CODES.INVALID_PAYLOAD);
        expect(error.message).toBe('Validation failed');
        expect(error.details).toEqual({ field: 'sessionId', reason: 'required' });
      });
    });

    describe('formatError', () => {
      it('should format WSError as-is', () => {
        const wsError: WSError = {
          code: WS_ERROR_CODES.NOT_FOUND,
          message: 'Session not found',
        };

        const result = handler.formatError(wsError);

        expect(result.code).toBe(WS_ERROR_CODES.NOT_FOUND);
        expect(result.message).toBe('Session not found');
      });

      it('should format Error instance', () => {
        const error = new Error('Authentication failed');
        const result = handler.formatError(error);

        expect(result.code).toBe(WS_ERROR_CODES.AUTH_FAILED);
        expect(result.message).toBe('Authentication failed');
      });

      it('should map token expired errors', () => {
        const error = new Error('jwt expired');
        const result = handler.formatError(error);

        expect(result.code).toBe(WS_ERROR_CODES.TOKEN_EXPIRED);
      });

      it('should map validation errors', () => {
        const error = new Error('Invalid payload');
        error.name = 'ValidationError';
        const result = handler.formatError(error);

        expect(result.code).toBe(WS_ERROR_CODES.INVALID_PAYLOAD);
      });

      it('should map not found errors', () => {
        const error = new Error('Session not found');
        const result = handler.formatError(error);

        expect(result.code).toBe(WS_ERROR_CODES.NOT_FOUND);
      });

      it('should map already exists errors', () => {
        const error = new Error('Session already exists');
        const result = handler.formatError(error);

        expect(result.code).toBe(WS_ERROR_CODES.ALREADY_EXISTS);
      });

      it('should map rate limit errors', () => {
        const error = new Error('Rate limit exceeded');
        const result = handler.formatError(error);

        expect(result.code).toBe(WS_ERROR_CODES.RATE_LIMITED);
      });

      it('should map forbidden errors', () => {
        const error = new Error('Access denied');
        const result = handler.formatError(error);

        expect(result.code).toBe(WS_ERROR_CODES.FORBIDDEN);
      });

      it('should map permission errors', () => {
        const error = new Error('Insufficient capabilities');
        const result = handler.formatError(error);

        expect(result.code).toBe(WS_ERROR_CODES.INSUFFICIENT_CAPABILITY);
      });

      it('should handle unknown error types', () => {
        const result = handler.formatError('string error');

        expect(result.code).toBe(WS_ERROR_CODES.INTERNAL_ERROR);
        expect(result.message).toBe('An unexpected error occurred');
        expect(result.details).toBeDefined();
      });

      it('should handle null', () => {
        const result = handler.formatError(null);

        expect(result.code).toBe(WS_ERROR_CODES.INTERNAL_ERROR);
      });

      it('should handle undefined', () => {
        const result = handler.formatError(undefined);

        expect(result.code).toBe(WS_ERROR_CODES.INTERNAL_ERROR);
      });

      it('should default to internal error for unknown Error', () => {
        const error = new Error('Some random error');
        const result = handler.formatError(error);

        expect(result.code).toBe(WS_ERROR_CODES.INTERNAL_ERROR);
        expect(result.message).toBe('Some random error');
      });
    });

    describe('createErrorResponse', () => {
      it('should create error response with request ID', () => {
        const error: WSError = {
          code: WS_ERROR_CODES.AUTH_FAILED,
          message: 'Invalid credentials',
        };

        const response = handler.createErrorResponse('req-123', error);

        expect(response.type).toBe('error');
        expect(response.id).toBeDefined();
        expect(response.timestamp).toBeDefined();
        expect(response.payload.requestId).toBe('req-123');
        expect(response.payload.error).toEqual(error);
      });

      it('should create error response with details', () => {
        const error: WSError = {
          code: WS_ERROR_CODES.INVALID_PAYLOAD,
          message: 'Validation failed',
          details: { field: 'sessionId' },
        };

        const response = handler.createErrorResponse('req-456', error);

        expect(response.payload.requestId).toBe('req-456');
        expect(response.payload.error.details).toEqual({ field: 'sessionId' });
      });
    });

    describe('mapError', () => {
      it('should map auth-related errors', () => {
        const tests = [
          { message: 'Unauthorized access', expectedCode: WS_ERROR_CODES.AUTH_FAILED },
          { message: 'Authentication failed', expectedCode: WS_ERROR_CODES.AUTH_FAILED },
        ];

        for (const test of tests) {
          const error = new Error(test.message);
          const result = handler.mapError(error);
          expect(result.code).toBe(test.expectedCode);
        }
      });

      it('should map token-related errors', () => {
        const tests = [
          { message: 'Token expired', expectedCode: WS_ERROR_CODES.TOKEN_EXPIRED },
          { message: 'jwt expired', expectedCode: WS_ERROR_CODES.TOKEN_EXPIRED },
          { message: 'Invalid token', expectedCode: WS_ERROR_CODES.TOKEN_INVALID },
          { message: 'jwt invalid', expectedCode: WS_ERROR_CODES.TOKEN_INVALID },
        ];

        for (const test of tests) {
          const error = new Error(test.message);
          const result = handler.mapError(error);
          expect(result.code).toBe(test.expectedCode);
        }
      });

      it('should map capability errors', () => {
        const tests = [
          { message: 'No capability', expectedCode: WS_ERROR_CODES.INSUFFICIENT_CAPABILITY },
          { message: 'Permission denied', expectedCode: WS_ERROR_CODES.INSUFFICIENT_CAPABILITY },
        ];

        for (const test of tests) {
          const error = new Error(test.message);
          const result = handler.mapError(error);
          expect(result.code).toBe(test.expectedCode);
        }
      });
    });

    describe('logError', () => {
      it('should log without throwing', () => {
        const error = new Error('Test error');

        expect(() => handler.logError(error)).not.toThrow();
      });

      it('should log with context', () => {
        const error = new Error('Test error');

        expect(() => handler.logError(error, { connectionId: 'conn-1' })).not.toThrow();
      });
    });
  });

  describe('createWSErrorResponse (helper)', () => {
    it('should create error response', () => {
      const response = createWSErrorResponse(
        'req-789',
        WS_ERROR_CODES.NOT_FOUND,
        'Session not found',
      );

      expect(response.type).toBe('error');
      expect(response.id).toBeDefined();
      expect(response.timestamp).toBeDefined();
      expect(response.payload.requestId).toBe('req-789');
      expect(response.payload.error.code).toBe(WS_ERROR_CODES.NOT_FOUND);
      expect(response.payload.error.message).toBe('Session not found');
    });

    it('should create error response with details', () => {
      const response = createWSErrorResponse(
        'req-abc',
        WS_ERROR_CODES.INVALID_PAYLOAD,
        'Invalid field',
        { field: 'sessionId' },
      );

      expect(response.payload.error.details).toEqual({ field: 'sessionId' });
    });

    it('should use default message if not provided', () => {
      const response = createWSErrorResponse('req-def', WS_ERROR_CODES.AUTH_REQUIRED);

      expect(response.payload.error.message).toBe(ERROR_MESSAGES.AUTH_REQUIRED);
    });
  });

  describe('createWSErrorObj (helper)', () => {
    it('should create WSError', () => {
      const error = createWSErrorObj(WS_ERROR_CODES.RATE_LIMITED);

      expect(error.code).toBe(WS_ERROR_CODES.RATE_LIMITED);
      expect(error.message).toBe(ERROR_MESSAGES.RATE_LIMITED);
    });

    it('should create WSError with custom message', () => {
      const error = createWSErrorObj(WS_ERROR_CODES.RATE_LIMITED, 'Too many requests');

      expect(error.message).toBe('Too many requests');
    });

    it('should create WSError with details', () => {
      const error = createWSErrorObj(
        WS_ERROR_CODES.RATE_LIMITED,
        'Too many requests',
        { retryAfter: 60 },
      );

      expect(error.details).toEqual({ retryAfter: 60 });
    });
  });

  describe('WSErrorClass', () => {
    it('should create error instance', () => {
      const error = new WSErrorClass(WS_ERROR_CODES.NOT_FOUND);

      expect(error.code).toBe(WS_ERROR_CODES.NOT_FOUND);
      expect(error.message).toBe(ERROR_MESSAGES.NOT_FOUND);
      expect(error.name).toBe('WSError');
    });

    it('should create error with custom message', () => {
      const error = new WSErrorClass(
        WS_ERROR_CODES.NOT_FOUND,
        'Session xyz not found',
      );

      expect(error.message).toBe('Session xyz not found');
    });

    it('should create error with details', () => {
      const error = new WSErrorClass(
        WS_ERROR_CODES.NOT_FOUND,
        'Session not found',
        { sessionId: 'xyz' },
      );

      expect(error.details).toEqual({ sessionId: 'xyz' });
    });

    it('should convert to WSError', () => {
      const error = new WSErrorClass(
        WS_ERROR_CODES.NOT_FOUND,
        'Session not found',
        { sessionId: 'xyz' },
      );

      const wsError = error.toWSError();

      expect(wsError.code).toBe(WS_ERROR_CODES.NOT_FOUND);
      expect(wsError.message).toBe('Session not found');
      expect(wsError.details).toEqual({ sessionId: 'xyz' });
    });

    it('should convert without details', () => {
      const error = new WSErrorClass(WS_ERROR_CODES.NOT_FOUND);
      const wsError = error.toWSError();

      expect(wsError.details).toBeUndefined();
    });

    it('should create error response', () => {
      const error = new WSErrorClass(
        WS_ERROR_CODES.NOT_FOUND,
        'Session not found',
        { sessionId: 'xyz' },
      );

      const response = error.toErrorResponse('req-123');

      expect(response.type).toBe('error');
      expect(response.id).toBeDefined();
      expect(response.timestamp).toBeDefined();
      expect(response.payload.requestId).toBe('req-123');
      expect(response.payload.error.code).toBe(WS_ERROR_CODES.NOT_FOUND);
      expect(response.payload.error.message).toBe('Session not found');
      expect(response.payload.error.details).toEqual({ sessionId: 'xyz' });
    });

    it('should be an Error instance', () => {
      const error = new WSErrorClass(WS_ERROR_CODES.NOT_FOUND);

      expect(error).toBeInstanceOf(Error);
    });
  });
});
