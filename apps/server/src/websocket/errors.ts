/**
 * WebSocket Error Handler
 *
 * Centralized error handling for WebSocket operations.
 * Formats errors consistently, maps error codes, and generates error responses.
 */

import type { FastifyBaseLogger } from 'fastify';
import {
  type WSError,
  type ErrorResponse,
  WS_ERROR_CODES,
  type WSErrorCode,
  createWSMessage,
} from '@openaidy/shared-types';

// ============================================================================
// Error Code Mappings
// ============================================================================

/**
 * Default messages for error codes
 */
export const ERROR_MESSAGES: Record<WSErrorCode, string> = {
  // Authentication errors
  AUTH_FAILED: 'Authentication failed',
  AUTH_REQUIRED: 'Authentication required',
  TOKEN_EXPIRED: 'Token has expired',
  TOKEN_INVALID: 'Token is invalid',

  // Authorization errors
  FORBIDDEN: 'Access denied',
  INSUFFICIENT_CAPABILITY: 'Insufficient capabilities',

  // Request errors
  INVALID_REQUEST: 'Invalid request',
  INVALID_PAYLOAD: 'Invalid payload',
  UNKNOWN_MESSAGE_TYPE: 'Unknown message type',

  // Rate limiting
  RATE_LIMITED: 'Rate limit exceeded',

  // Connection errors
  CONNECTION_LIMIT: 'Maximum connections reached',
  CONNECTION_CLOSED: 'Connection closed',

  // Resource errors
  NOT_FOUND: 'Resource not found',
  ALREADY_EXISTS: 'Resource already exists',

  // Server errors
  INTERNAL_ERROR: 'Internal server error',
  SERVICE_UNAVAILABLE: 'Service unavailable',
};

// ============================================================================
// WSErrorHandler Class
// ============================================================================

/**
 * Centralized error handler for WebSocket operations
 */
export class WSErrorHandler {
  constructor(private logger: FastifyBaseLogger) {}

  /**
   * Create a WSError object
   */
  createError(
    code: WSErrorCode,
    message?: string,
    details?: Record<string, unknown>,
  ): WSError {
    const error: WSError = {
      code,
      message: message ?? ERROR_MESSAGES[code] ?? code,
    };
    if (details !== undefined) {
      error.details = details;
    }
    return error;
  }

  /**
   * Format an unknown error into a WSError
   */
  formatError(error: unknown): WSError {
    // Already a WSError
    if (this.isWSError(error)) {
      return error;
    }

    // Error instance
    if (error instanceof Error) {
      const mapped = this.mapError(error);
      return this.createError(mapped.code as WSErrorCode, mapped.message);
    }

    // Unknown error type
    return this.createError(
      WS_ERROR_CODES.INTERNAL_ERROR,
      'An unexpected error occurred',
      { original: String(error) },
    );
  }

  /**
   * Create an error response message
   */
  createErrorResponse(requestId: string, error: WSError): ErrorResponse {
    return createWSMessage('error', {
      requestId,
      error,
    });
  }

  /**
   * Log an error with optional context
   */
  logError(error: unknown, context?: Record<string, unknown>): void {
    const wsError = this.formatError(error);
    const logData = {
      code: wsError.code,
      message: wsError.message,
      ...context,
    };

    // Log based on error severity
    if (this.isClientError(wsError.code)) {
      this.logger.warn(logData, wsError.message);
    } else {
      this.logger.error(logData, wsError.message);
    }
  }

  /**
   * Map an Error to error code and message
   */
  mapError(error: Error): { code: string; message: string } {
    // Check for specific error types
    const errorMessage = error.message.toLowerCase();
    const errorName = error.name?.toLowerCase() ?? '';

    // Authentication errors
    if (
      errorMessage.includes('auth') ||
      errorMessage.includes('unauthorized')
    ) {
      return { code: WS_ERROR_CODES.AUTH_FAILED, message: error.message };
    }

    if (errorMessage.includes('token expired') || errorMessage.includes('jwt expired')) {
      return { code: WS_ERROR_CODES.TOKEN_EXPIRED, message: error.message };
    }

    if (errorMessage.includes('invalid token') || errorMessage.includes('jwt invalid')) {
      return { code: WS_ERROR_CODES.TOKEN_INVALID, message: error.message };
    }

    // Authorization errors
    if (errorMessage.includes('forbidden') || errorMessage.includes('access denied')) {
      return { code: WS_ERROR_CODES.FORBIDDEN, message: error.message };
    }

    if (errorMessage.includes('capa') || errorMessage.includes('permission')) {
      return { code: WS_ERROR_CODES.INSUFFICIENT_CAPABILITY, message: error.message };
    }

    // Validation errors
    if (
      errorName.includes('validation') ||
      errorMessage.includes('invalid') ||
      errorMessage.includes('required')
    ) {
      return { code: WS_ERROR_CODES.INVALID_PAYLOAD, message: error.message };
    }

    if (errorMessage.includes('not found')) {
      return { code: WS_ERROR_CODES.NOT_FOUND, message: error.message };
    }

    if (errorMessage.includes('already exists') || errorMessage.includes('duplicate')) {
      return { code: WS_ERROR_CODES.ALREADY_EXISTS, message: error.message };
    }

    // Rate limiting
    if (errorMessage.includes('rate limit') || errorMessage.includes('too many')) {
      return { code: WS_ERROR_CODES.RATE_LIMITED, message: error.message };
    }

    // Default to internal error
    return {
      code: WS_ERROR_CODES.INTERNAL_ERROR,
      message: error.message || 'Internal server error',
    };
  }

  /**
   * Check if error code is a client error (4xx equivalent)
   */
  private isClientError(code: string): boolean {
    const clientErrorCodes = [
      WS_ERROR_CODES.AUTH_FAILED,
      WS_ERROR_CODES.AUTH_REQUIRED,
      WS_ERROR_CODES.TOKEN_EXPIRED,
      WS_ERROR_CODES.TOKEN_INVALID,
      WS_ERROR_CODES.FORBIDDEN,
      WS_ERROR_CODES.INSUFFICIENT_CAPABILITY,
      WS_ERROR_CODES.INVALID_REQUEST,
      WS_ERROR_CODES.INVALID_PAYLOAD,
      WS_ERROR_CODES.UNKNOWN_MESSAGE_TYPE,
      WS_ERROR_CODES.RATE_LIMITED,
      WS_ERROR_CODES.NOT_FOUND,
      WS_ERROR_CODES.ALREADY_EXISTS,
    ];
    return clientErrorCodes.includes(code as WSErrorCode);
  }

  /**
   * Check if value is a WSError
   */
  private isWSError(value: unknown): value is WSError {
    if (typeof value !== 'object' || value === null) return false;
    const err = value as Record<string, unknown>;
    return typeof err.code === 'string' && typeof err.message === 'string';
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create an error response directly
 */
export function createWSErrorResponse(
  requestId: string,
  code: WSErrorCode,
  message?: string,
  details?: Record<string, unknown>,
): ErrorResponse {
  const error: WSError = {
    code,
    message: message ?? ERROR_MESSAGES[code] ?? code,
  };
  if (details !== undefined) {
    error.details = details;
  }

  return createWSMessage('error', {
    requestId,
    error,
  });
}

/**
 * Create a WSError directly
 */
export function createWSErrorObj(
  code: WSErrorCode,
  message?: string,
  details?: Record<string, unknown>,
): WSError {
  const error: WSError = {
    code,
    message: message ?? ERROR_MESSAGES[code] ?? code,
  };
  if (details !== undefined) {
    error.details = details;
  }
  return error;
}

// ============================================================================
// Error Class
// ============================================================================

/**
 * Custom error class for WebSocket errors
 */
export class WSErrorClass extends Error {
  constructor(
    public readonly code: WSErrorCode,
    message?: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message ?? ERROR_MESSAGES[code] ?? code);
    this.name = 'WSError';
  }

  /**
   * Convert to WSError type
   */
  toWSError(): WSError {
    const error: WSError = {
      code: this.code,
      message: this.message,
    };
    if (this.details !== undefined) {
      error.details = this.details;
    }
    return error;
  }

  /**
   * Create an error response
   */
  toErrorResponse(requestId: string): ErrorResponse {
    return createWSMessage('error', {
      requestId,
      error: this.toWSError(),
    });
  }
}

export default WSErrorHandler;
