import { describe, it, expect, beforeEach, vi } from 'vitest';
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
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
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
      vi.clearAllMocks();
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
        expect(result.details).toEqual({ original: 'string error' });
      });

      it('should handle null errors', () => {
        const result = handler.formatError(null);

        expect(result.code).toBe(WS_ERROR_CODES.INTERNAL_ERROR);
      });

      it('should fall back to internal error for generic errors', () => {
        const error = new Error('Some random error');
        const result = handler.formatError(error);

        expect(result.code).toBe(WS_ERROR_CODES.INTERNAL_ERROR);
      });
    });

    describe('createErrorResponse', () => {
      it('should create error response message', () => {
        const error: WSError = {
          code: WS_ERROR_CODES.NOT_FOUND,
          message: 'Session not found',
        };

        const response = handler.createErrorResponse('req-123', error);

        expect(response.type).toBe('error');
        expect(response.payload.requestId).toBe('req-123');
        expect(response.payload.error.code).toBe(WS_ERROR_CODES.NOT_FOUND);
      });

      it('should include error details in response', () => {
        const error: WSError = {
          code: WS_ERROR_CODES.INVALID_PAYLOAD,
          message: 'Validation failed',
          details: { field: 'sessionId' },
        };

        const response = handler.createErrorResponse('req-123', error);

        expect(response.payload.error.details).toEqual({ field: 'sessionId' });
      });
    });

    describe('logError', () => {
      it('should log client errors as warnings', () => {
        const error = handler.createError(WS_ERROR_CODES.INVALID_REQUEST);
        handler.logError(error, { connectionId: 'conn-1' });

        expect(mockLogger.warn).toHaveBeenCalled();
      });

      it('should log server errors as errors', () => {
        const error = handler.createError(WS_ERROR_CODES.INTERNAL_ERROR);
        handler.logError(error, { connectionId: 'conn-1' });

        expect(mockLogger.error).toHaveBeenCalled();
      });

      it('should include context in log', () => {
        const error = handler.createError(WS_ERROR_CODES.NOT_FOUND);
        handler.logError(error, { sessionId: 'sess-1' });

        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ sessionId: 'sess-1' }),
          expect.any(String),
        );
      });
    });

    describe('mapError', () => {
      it('should map auth errors', () => {
        const result = handler.mapError(new Error('Unauthorized access'));
        expect(result.code).toBe(WS_ERROR_CODES.AUTH_FAILED);
      });

      it('should map token invalid errors', () => {
        const result = handler.mapError(new Error('jwt invalid'));
        expect(result.code).toBe(WS_ERROR_CODES.TOKEN_INVALID);
      });

      it('should map duplicate errors', () => {
        const result = handler.mapError(new Error('duplicate key'));
        expect(result.code).toBe(WS_ERROR_CODES.ALREADY_EXISTS);
      });

      it('should map too many requests', () => {
        const result = handler.mapError(new Error('too many requests'));
        expect(result.code).toBe(WS_ERROR_CODES.RATE_LIMITED);
      });

      it('should preserve original message', () => {
        const result = handler.mapError(new Error('Custom error message'));
        expect(result.message).toBe('Custom error message');
      });
    });
  });

  describe('createWSErrorResponse (helper)', () => {
    it('should create error response with default message', () => {
      const response = createWSErrorResponse('req-123', WS_ERROR_CODES.AUTH_REQUIRED);

      expect(response.type).toBe('error');
      expect(response.payload.requestId).toBe('req-123');
      expect(response.payload.error.code).toBe(WS_ERROR_CODES.AUTH_REQUIRED);
      expect(response.payload.error.message).toBe(ERROR_MESSAGES.AUTH_REQUIRED);
    });

    it('should create error response with custom message', () => {
      const response = createWSErrorResponse(
        'req-123',
        WS_ERROR_CODES.NOT_FOUND,
        'Session abc not found',
      );

      expect(response.payload.error.message).toBe('Session abc not found');
    });

    it('should create error response with details', () => {
      const response = createWSErrorResponse(
        'req-123',
        WS_ERROR_CODES.INVALID_PAYLOAD,
        'Validation failed',
        { fields: ['sessionId', 'type'] },
      );

      expect(response.payload.error.details).toEqual({ fields: ['sessionId', 'type'] });
    });
  });

  describe('createWSErrorObj (helper)', () => {
    it('should create WSError with default message', () => {
      const error = createWSErrorObj(WS_ERROR_CODES.RATE_LIMITED);

      expect(error.code).toBe(WS_ERROR_CODES.RATE_LIMITED);
      expect(error.message).toBe(ERROR_MESSAGES.RATE_LIMITED);
    });

    it('should create WSError with custom message', () => {
      const error = createWSErrorObj(WS_ERROR_CODES.RATE_LIMITED, 'Custom rate limit');

      expect(error.message).toBe('Custom rate limit');
    });

    it('should create WSError with details', () => {
      const error = createWSErrorObj(
        WS_ERROR_CODES.RATE_LIMITED,
        'Rate limited',
        { retryAfter: 60 },
      );

      expect(error.details).toEqual({ retryAfter: 60 });
    });
  });

  describe('WSErrorClass', () => {
    it('should create error with code and default message', () => {
      const error = new WSErrorClass(WS_ERROR_CODES.FORBIDDEN);

      expect(error.code).toBe(WS_ERROR_CODES.FORBIDDEN);
      expect(error.message).toBe(ERROR_MESSAGES.FORBIDDEN);
      expect(error.name).toBe('WSError');
    });

    it('should create error with custom message', () => {
      const error = new WSErrorClass(WS_ERROR_CODES.FORBIDDEN, 'Access denied to resource');

      expect(error.message).toBe('Access denied to resource');
    });

    it('should create error with details', () => {
      const error = new WSErrorClass(
        WS_ERROR_CODES.INSUFFICIENT_CAPABILITY,
        'Missing capability',
        { required: 'admin', actual: ['read'] },
      );

      expect(error.details).toEqual({ required: 'admin', actual: ['read'] });
    });

    it('should convert to WSError', () => {
      const error = new WSErrorClass(
        WS_ERROR_CODES.NOT_FOUND,
        'Not found',
        { resource: 'session' },
      );

      const wsError = error.toWSError();

      expect(wsError.code).toBe(WS_ERROR_CODES.NOT_FOUND);
      expect(wsError.message).toBe('Not found');
      expect(wsError.details).toEqual({ resource: 'session' });
    });

    it('should create error response', () => {
      const error = new WSErrorClass(WS_ERROR_CODES.AUTH_REQUIRED);
      const response = error.toErrorResponse('req-456');

      expect(response.type).toBe('error');
      expect(response.payload.requestId).toBe('req-456');
      expect(response.payload.error.code).toBe(WS_ERROR_CODES.AUTH_REQUIRED);
    });

    it('should be instance of Error', () => {
      const error = new WSErrorClass(WS_ERROR_CODES.INTERNAL_ERROR);

      expect(error).toBeInstanceOf(Error);
    });
  });
});
