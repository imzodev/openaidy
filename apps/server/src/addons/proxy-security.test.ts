/**
 * Proxy Security Tests
 *
 * Unit tests for the proxy security module.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ProxySecurity,
  DataProtection,
  getSecurityHeaders,
  createSecureErrorResponse,
} from './proxy-security';

// ============================================================================
// ProxySecurity Tests
// ============================================================================

describe('ProxySecurity', () => {
  let security: ProxySecurity;

  beforeEach(() => {
    security = new ProxySecurity();
  });

  afterEach(() => {
    security = new ProxySecurity();
  });

  describe('detectThreats', () => {
    it('should not detect threats in clean requests', () => {
      const mockRequest = {
        url: '/api/test',
        method: 'GET',
        body: '',
        headers: {},
      } as unknown as import('fastify').FastifyRequest;

      const context = {
        ip: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        contentType: '',
        contentLength: 0,
        urlLength: 10,
      };

      const result = security.detectThreats(mockRequest, context);

      expect(result.threats).toHaveLength(0);
    });

    it('should detect SQL injection patterns', () => {
      const mockRequest = {
        url: '/api/test?query=SELECT * FROM users WHERE id=1',
        method: 'GET',
        body: '',
        headers: {},
      } as unknown as import('fastify').FastifyRequest;

      const context = {
        ip: '192.168.1.1',
        contentLength: 0,
        urlLength: 70,
      };

      const result = security.detectThreats(mockRequest, context);

      expect(result.threats.some((t) => t.type === 'SQL_INJECTION')).toBe(true);
    });

    it('should detect command injection patterns', () => {
      const mockRequest = {
        url: '/api/test?cmd=ls&file=/etc/passwd',
        method: 'GET',
        body: '',
        headers: {},
      } as unknown as import('fastify').FastifyRequest;

      const context = {
        ip: '192.168.1.1',
        contentLength: 0,
        urlLength: 40,
      };

      const result = security.detectThreats(mockRequest, context);

      expect(result.threats.some((t) => t.type === 'COMMAND_INJECTION')).toBe(
        true,
      );
    });

    it('should detect XSS patterns', () => {
      const mockRequest = {
        url: '/api/test?input=<script>alert(1)</script>',
        method: 'GET',
        body: '',
        headers: {},
      } as unknown as import('fastify').FastifyRequest;

      const context = {
        ip: '192.168.1.1',
        contentLength: 0,
        urlLength: 50,
      };

      const result = security.detectThreats(mockRequest, context);

      expect(result.threats.some((t) => t.type === 'XSS')).toBe(true);
    });

    it('should detect path traversal patterns', () => {
      const mockRequest = {
        url: '/api/files?path=../../etc/passwd',
        method: 'GET',
        body: '',
        headers: {},
      } as unknown as import('fastify').FastifyRequest;

      const context = {
        ip: '192.168.1.1',
        contentLength: 0,
        urlLength: 35,
      };

      const result = security.detectThreats(mockRequest, context);

      expect(result.threats.some((t) => t.type === 'PATH_TRAVERSAL')).toBe(
        true,
      );
    });

    it('should block requests exceeding size limit', () => {
      const mockRequest = {
        url: '/api/test',
        method: 'POST',
        body: 'x'.repeat(11 * 1024 * 1024),
        headers: {},
      } as unknown as import('fastify').FastifyRequest;

      const context = {
        ip: '192.168.1.1',
        contentType: 'application/json',
        contentLength: 11 * 1024 * 1024,
        urlLength: 10,
      };

      const result = security.detectThreats(mockRequest, context);

      expect(
        result.threats.some((t) => t.type === 'REQUEST_SIZE_EXCEEDED'),
      ).toBe(true);
    });

    it('should block requests exceeding URL length', () => {
      const mockRequest = {
        url: 'x'.repeat(9000),
        method: 'GET',
        body: '',
        headers: {},
      } as unknown as import('fastify').FastifyRequest;

      const context = {
        ip: '192.168.1.1',
        contentLength: 0,
        urlLength: 9000,
      };

      const result = security.detectThreats(mockRequest, context);

      expect(result.threats.some((t) => t.type === 'URL_LENGTH_EXCEEDED')).toBe(
        true,
      );
    });

    it('should calculate threat score correctly', () => {
      const mockRequest = {
        url: '/api/test?param=1',
        method: 'GET',
        body: '',
        headers: {},
      } as unknown as import('fastify').FastifyRequest;

      const context = {
        ip: '192.168.1.1',
        contentLength: 0,
        urlLength: 25,
      };

      const result = security.detectThreats(mockRequest, context);

      expect(result.score).toBe(0);
    });
  });

  describe('recordSecurityEvent', () => {
    it('should record security events', () => {
      security.recordSecurityEvent({
        type: 'INJECTION_ATTEMPT',
        addonId: 'test-addon',
        timestamp: new Date(),
        details: { path: '/api/test' },
        severity: 'critical',
        blocked: true,
      });

      const events = security.getSecurityEvents();
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe('INJECTION_ATTEMPT');
    });

    it('should limit stored events', () => {
      const smallSecurity = new ProxySecurity(5);

      for (let i = 0; i < 10; i++) {
        smallSecurity.recordSecurityEvent({
          type: 'SUSPICIOUS_PATTERN',
          addonId: 'test-addon',
          timestamp: new Date(),
          details: { attempt: i },
          severity: 'low',
          blocked: false,
        });
      }

      const events = smallSecurity.getSecurityEvents();
      expect(events.length).toBeLessThanOrEqual(5);
    });
  });

  describe('IP blocking', () => {
    it('should track suspicious patterns by IP', () => {
      for (let i = 0; i < 5; i++) {
        security.recordSecurityEvent({
          type: 'SUSPICIOUS_PATTERN',
          addonId: 'test-addon',
          timestamp: new Date(),
          details: { ip: '192.168.1.100' },
          severity: 'low',
          blocked: false,
        });
      }

      expect(security.isIPBlocked('192.168.1.100')).toBe(false);
    });

    it('should block IP after too many suspicious requests', () => {
      const smallSecurity = new ProxySecurity(10);

      for (let i = 0; i < 105; i++) {
        smallSecurity.recordSecurityEvent({
          type: 'SUSPICIOUS_PATTERN',
          addonId: 'test-addon',
          timestamp: new Date(),
          details: { ip: '192.168.1.200' },
          severity: 'low',
          blocked: false,
        });
      }

      expect(smallSecurity.isIPBlocked('192.168.1.200')).toBe(true);
    });

    it('should unblock IP', () => {
      security = new ProxySecurity(5);

      for (let i = 0; i < 105; i++) {
        security.recordSecurityEvent({
          type: 'SUSPICIOUS_PATTERN',
          addonId: 'test-addon',
          timestamp: new Date(),
          details: { ip: '192.168.1.250' },
          severity: 'low',
          blocked: false,
        });
      }

      expect(security.isIPBlocked('192.168.1.250')).toBe(true);

      security.unblockIP('192.168.1.250');
      expect(security.isIPBlocked('192.168.1.250')).toBe(false);
    });
  });

  describe('getSecurityMetrics', () => {
    it('should return security metrics', () => {
      security.recordSecurityEvent({
        type: 'INJECTION_ATTEMPT',
        addonId: 'test-addon',
        timestamp: new Date(),
        details: {},
        severity: 'critical',
        blocked: true,
      });

      const metrics = security.getSecurityMetrics();

      expect(metrics.totalEvents).toBe(1);
      expect(metrics.blockedRequests).toBe(1);
      expect(metrics.blockedIPs).toBe(0);
    });
  });
});

// ============================================================================
// DataProtection Tests
// ============================================================================

describe('DataProtection', () => {
  let dataProtection: DataProtection;

  beforeEach(() => {
    dataProtection = new DataProtection();
  });

  describe('redactSensitiveData', () => {
    it('should redact email addresses', () => {
      const input = { email: 'john.doe@example.com' };
      const result = dataProtection.redactSensitiveData(input) as typeof input;

      expect(result.email).toBe('[EMAIL_REDACTED]');
    });

    it('should redact phone numbers', () => {
      const input = { phone: '555-123-4567' };
      const result = dataProtection.redactSensitiveData(input) as typeof input;

      expect(result.phone).toBe('[PHONE_REDACTED]');
    });

    it('should redact SSN', () => {
      const input = { ssn: '123-45-6789' };
      const result = dataProtection.redactSensitiveData(input) as typeof input;

      expect(result.ssn).toBe('[SSN_REDACTED]');
    });

    it('should redact credit card numbers', () => {
      const input = { card: '4111-1111-1111-1111' };
      const result = dataProtection.redactSensitiveData(input) as typeof input;

      expect(result.card).toBe('[CARD_REDACTED]');
    });

    it('should redact API keys', () => {
      const input = { apiKey: 'abcdefghijklmnopqrstuvwxyz1234567890' };
      const result = dataProtection.redactSensitiveData(input) as typeof input;

      expect(result.apiKey).toBe('[API_KEY_REDACTED]');
    });

    it('should handle nested objects', () => {
      const input = {
        user: {
          name: 'John',
          email: 'john@example.com',
          contact: {
            phone: '555-987-6543',
          },
        },
      };

      type RedactedResult = {
        user: {
          name: string;
          email: string;
          contact: { phone: string };
        };
      };

      const result = dataProtection.redactSensitiveData(
        input,
      ) as RedactedResult;

      expect(result.user.name).toBe('John');
      expect(result.user.email).toBe('[EMAIL_REDACTED]');
      expect(result.user.contact.phone).toBe('[PHONE_REDACTED]');
    });

    it('should handle arrays', () => {
      const input = {
        users: [{ email: 'user1@example.com' }, { email: 'user2@example.com' }],
      };

      type RedactedUsersResult = {
        users: Array<{ email: string }>;
      };

      const result = dataProtection.redactSensitiveData(
        input,
      ) as unknown as RedactedUsersResult;

      expect(result.users).toBeDefined();
      expect(result.users[0]?.email).toBe('[EMAIL_REDACTED]');
      expect(result.users[1]?.email).toBe('[EMAIL_REDACTED]');
    });

    it('should preserve non-sensitive data', () => {
      const input = {
        id: '123',
        name: 'Test Item',
        status: 'active',
      };

      const result = dataProtection.redactSensitiveData(input) as typeof input;

      expect(result).toEqual(input);
    });

    it('should handle strings directly', () => {
      const input = 'Contact me at john@example.com or 555-123-4567';
      const result = dataProtection.redactSensitiveData(input);

      expect(result).toContain('[EMAIL_REDACTED]');
      expect(result).toContain('[PHONE_REDACTED]');
    });

    it('should handle null and undefined', () => {
      expect(dataProtection.redactSensitiveData(null)).toBeNull();
      expect(dataProtection.redactSensitiveData(undefined)).toBeUndefined();
    });
  });

  describe('containsPII', () => {
    it('should detect email in string', () => {
      expect(dataProtection.containsPII('Hello from john@example.com')).toBe(
        true,
      );
    });

    it('should detect phone in string', () => {
      expect(dataProtection.containsPII('Call me at 555-123-4567')).toBe(true);
    });

    it('should return false for clean strings', () => {
      expect(dataProtection.containsPII('This is a clean message')).toBe(false);
    });
  });

  describe('detectPII', () => {
    it('should detect email type', () => {
      const types = dataProtection.detectPII('Contact: john@example.com');
      expect(types).toContain('email');
    });

    it('should detect phone type', () => {
      const types = dataProtection.detectPII('Phone: 555-123-4567');
      expect(types).toContain('phone');
    });

    it('should detect SSN type', () => {
      const types = dataProtection.detectPII('SSN: 123-45-6789');
      expect(types).toContain('ssn');
    });

    it('should detect credit card type', () => {
      const types = dataProtection.detectPII('Card: 4111-1111-1111-1111');
      expect(types).toContain('credit_card');
    });

    it('should return empty array for clean strings', () => {
      const types = dataProtection.detectPII('Clean message');
      expect(types).toHaveLength(0);
    });
  });
});

// ============================================================================
// Security Headers Tests
// ============================================================================

describe('Security Headers', () => {
  describe('getSecurityHeaders', () => {
    it('should return all security headers', () => {
      const headers = getSecurityHeaders();

      expect(headers['X-Content-Type-Options']).toBe('nosniff');
      expect(headers['X-Frame-Options']).toBe('DENY');
      expect(headers['X-XSS-Protection']).toBe('1; mode=block');
      expect(headers['Strict-Transport-Security']).toBeDefined();
      expect(headers['Content-Security-Policy']).toBeDefined();
    });
  });
});

// ============================================================================
// Secure Error Response Tests
// ============================================================================

describe('createSecureErrorResponse', () => {
  it('should create a secure error response', () => {
    const error = createSecureErrorResponse(
      'PERMISSION_DENIED',
      'You do not have permission to access this resource',
      'req_123456',
      false,
    );

    expect(error.error).toBe('PERMISSION_DENIED');
    expect(error.message).toBe(
      'You do not have permission to access this resource',
    );
    expect(error.requestId).toBe('req_123456');
    expect(error.timestamp).toBeDefined();
    expect(error.retryable).toBe(false);
  });

  it('should default retryable to false', () => {
    const error = createSecureErrorResponse('ERROR', 'Message', 'req_123');

    expect(error.retryable).toBe(false);
  });

  it('should allow retryable to be true', () => {
    const error = createSecureErrorResponse(
      'RATE_LIMIT',
      'Too many requests',
      'req_123',
      true,
    );

    expect(error.retryable).toBe(true);
  });
});
