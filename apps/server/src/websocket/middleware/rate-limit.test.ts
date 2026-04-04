import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  RateLimiter,
  RateLimitMiddleware,
  createRateLimitMiddleware,
  type RateLimitMiddlewareOptions,
} from './rate-limit';
import { defaultWebSocketConfig } from '../types';

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter(5, 60000); // 5 requests per minute
  });

  describe('check', () => {
    it('should allow requests under limit', () => {
      const result = limiter.check();
      expect(result.allowed).toBe(true);
      expect(result.info.remaining).toBe(5);
      expect(result.info.limit).toBe(5);
    });

    it('should track remaining requests', () => {
      limiter.recordRequest();
      limiter.recordRequest();

      const result = limiter.check();
      expect(result.info.remaining).toBe(3);
    });

    it('should deny requests over limit', () => {
      for (let i = 0; i < 5; i++) {
        limiter.recordRequest();
      }

      const result = limiter.check();
      expect(result.allowed).toBe(false);
      expect(result.info.remaining).toBe(0);
    });

    it('should return reset time in the future', () => {
      const now = Date.now();
      const result = limiter.check();
      expect(result.info.reset).toBeGreaterThan(now);
    });
  });

  describe('recordRequest', () => {
    it('should record requests', () => {
      limiter.recordRequest();
      expect(limiter.getRequestCount()).toBe(1);

      limiter.recordRequest();
      expect(limiter.getRequestCount()).toBe(2);
    });
  });

  describe('reset', () => {
    it('should reset the limiter', () => {
      for (let i = 0; i < 5; i++) {
        limiter.recordRequest();
      }

      limiter.reset();

      const result = limiter.check();
      expect(result.allowed).toBe(true);
      expect(result.info.remaining).toBe(5);
    });
  });

  describe('isExpired', () => {
    it('should return false for new limiter', () => {
      expect(limiter.isExpired()).toBe(false);
    });

    it('should return true after window expires', async () => {
      const shortLimiter = new RateLimiter(5, 10); // 10ms window
      await new Promise((r) => setTimeout(r, 15));
      expect(shortLimiter.isExpired()).toBe(true);
    });
  });

  describe('getRequestCount', () => {
    it('should return current request count', () => {
      expect(limiter.getRequestCount()).toBe(0);

      limiter.recordRequest();
      expect(limiter.getRequestCount()).toBe(1);

      limiter.recordRequest();
      expect(limiter.getRequestCount()).toBe(2);
    });
  });

  describe('getRemaining', () => {
    it('should return remaining requests', () => {
      expect(limiter.getRemaining()).toBe(5);

      limiter.recordRequest();
      expect(limiter.getRemaining()).toBe(4);

      for (let i = 0; i < 4; i++) {
        limiter.recordRequest();
      }
      expect(limiter.getRemaining()).toBe(0);
    });
  });

  describe('window expiration', () => {
    it('should reset when window expires', async () => {
      const shortLimiter = new RateLimiter(2, 20); // 20ms window

      shortLimiter.recordRequest();
      shortLimiter.recordRequest();

      expect(shortLimiter.check().allowed).toBe(false);

      await new Promise((r) => setTimeout(r, 25));

      const result = shortLimiter.check();
      expect(result.allowed).toBe(true);
      expect(result.info.remaining).toBe(2);
    });
  });
});

describe('RateLimitMiddleware', () => {
  let middleware: RateLimitMiddleware;

  const testOptions: RateLimitMiddlewareOptions = {
    connectionLimit: 5,
    connectionWindow: 60000,
    globalLimit: 20,
    globalWindow: 60000,
    ipLimit: 10,
    ipWindow: 60000,
    cleanupInterval: 10000,
  };

  beforeEach(() => {
    middleware = new RateLimitMiddleware(defaultWebSocketConfig, testOptions);
  });

  afterEach(() => {
    middleware.shutdown();
  });

  describe('checkConnection', () => {
    it('should check connection rate limit', () => {
      const result = middleware.checkConnection('conn-1');
      expect(result.allowed).toBe(true);
      expect(result.info.remaining).toBe(5);
    });

    it('should track per-connection limits', () => {
      middleware.recordConnectionRequest('conn-1');
      middleware.recordConnectionRequest('conn-1');
      middleware.recordConnectionRequest('conn-1');

      const result = middleware.checkConnection('conn-1');
      expect(result.info.remaining).toBe(2);
    });

    it('should deny when connection limit exceeded', () => {
      for (let i = 0; i < 5; i++) {
        middleware.recordConnectionRequest('conn-1');
      }

      const result = middleware.checkConnection('conn-1');
      expect(result.allowed).toBe(false);
    });
  });

  describe('checkGlobal', () => {
    it('should check global rate limit', () => {
      const result = middleware.checkGlobal();
      expect(result.allowed).toBe(true);
      expect(result.info.remaining).toBe(20);
    });

    it('should track global limits', () => {
      for (let i = 0; i < 15; i++) {
        middleware.recordGlobalRequest();
      }

      const result = middleware.checkGlobal();
      expect(result.info.remaining).toBe(5);
    });

    it('should deny when global limit exceeded', () => {
      for (let i = 0; i < 20; i++) {
        middleware.recordGlobalRequest();
      }

      const result = middleware.checkGlobal();
      expect(result.allowed).toBe(false);
    });
  });

  describe('checkIP', () => {
    it('should check IP rate limit', () => {
      const result = middleware.checkIP('192.168.1.1');
      expect(result.allowed).toBe(true);
      expect(result.info.remaining).toBe(10);
    });

    it('should track per-IP limits', () => {
      for (let i = 0; i < 5; i++) {
        middleware.recordIPRequest('192.168.1.1');
      }

      const result = middleware.checkIP('192.168.1.1');
      expect(result.info.remaining).toBe(5);
    });

    it('should deny when IP limit exceeded', () => {
      for (let i = 0; i < 10; i++) {
        middleware.recordIPRequest('192.168.1.1');
      }

      const result = middleware.checkIP('192.168.1.1');
      expect(result.allowed).toBe(false);
    });

    it('should track IPs separately', () => {
      middleware.recordIPRequest('192.168.1.1');
      middleware.recordIPRequest('192.168.1.2');

      expect(middleware.checkIP('192.168.1.1').info.remaining).toBe(9);
      expect(middleware.checkIP('192.168.1.2').info.remaining).toBe(9);
    });
  });

  describe('checkAll', () => {
    it('should check all rate limits', () => {
      const result = middleware.checkAll('conn-1', '192.168.1.1');

      expect(result.allowed).toBe(true);
      expect(result.connection.allowed).toBe(true);
      expect(result.global.allowed).toBe(true);
      expect(result.ip?.allowed).toBe(true);
    });

    it('should deny if connection limit exceeded', () => {
      for (let i = 0; i < 5; i++) {
        middleware.recordConnectionRequest('conn-1');
      }

      const result = middleware.checkAll('conn-1', '192.168.1.1');
      expect(result.allowed).toBe(false);
      expect(result.connection.allowed).toBe(false);
    });

    it('should deny if global limit exceeded', () => {
      for (let i = 0; i < 20; i++) {
        middleware.recordGlobalRequest();
      }

      const result = middleware.checkAll('conn-1', '192.168.1.1');
      expect(result.allowed).toBe(false);
      expect(result.global.allowed).toBe(false);
    });

    it('should deny if IP limit exceeded', () => {
      for (let i = 0; i < 10; i++) {
        middleware.recordIPRequest('192.168.1.1');
      }

      const result = middleware.checkAll('conn-1', '192.168.1.1');
      expect(result.allowed).toBe(false);
      expect(result.ip?.allowed).toBe(false);
    });

    it('should work without IP', () => {
      const result = middleware.checkAll('conn-1');
      expect(result.allowed).toBe(true);
      expect(result.ip).toBeUndefined();
    });
  });

  describe('recordRequest', () => {
    it('should record request for all limiters', () => {
      middleware.recordRequest('conn-1', '192.168.1.1');

      const connResult = middleware.checkConnection('conn-1');
      const globalResult = middleware.checkGlobal();
      const ipResult = middleware.checkIP('192.168.1.1');

      expect(connResult.info.remaining).toBe(4);
      expect(globalResult.info.remaining).toBe(19);
      expect(ipResult.info.remaining).toBe(9);
    });
  });

  describe('resetConnection', () => {
    it('should reset connection limiter', () => {
      for (let i = 0; i < 5; i++) {
        middleware.recordConnectionRequest('conn-1');
      }

      middleware.resetConnection('conn-1');

      const result = middleware.checkConnection('conn-1');
      expect(result.allowed).toBe(true);
      expect(result.info.remaining).toBe(5);
    });
  });

  describe('resetIP', () => {
    it('should reset IP limiter', () => {
      for (let i = 0; i < 10; i++) {
        middleware.recordIPRequest('192.168.1.1');
      }

      middleware.resetIP('192.168.1.1');

      const result = middleware.checkIP('192.168.1.1');
      expect(result.allowed).toBe(true);
      expect(result.info.remaining).toBe(10);
    });
  });

  describe('resetGlobal', () => {
    it('should reset global limiter', () => {
      for (let i = 0; i < 20; i++) {
        middleware.recordGlobalRequest();
      }

      middleware.resetGlobal();

      const result = middleware.checkGlobal();
      expect(result.allowed).toBe(true);
      expect(result.info.remaining).toBe(20);
    });
  });

  describe('resetAll', () => {
    it('should reset all limiters', () => {
      middleware.recordConnectionRequest('conn-1');
      middleware.recordIPRequest('192.168.1.1');
      middleware.recordGlobalRequest();

      middleware.resetAll();

      expect(middleware.checkConnection('conn-1').info.remaining).toBe(5);
      expect(middleware.checkIP('192.168.1.1').info.remaining).toBe(10);
      expect(middleware.checkGlobal().info.remaining).toBe(20);
    });
  });

  describe('getters', () => {
    it('should get connection info', () => {
      middleware.recordConnectionRequest('conn-1');
      const info = middleware.getConnectionInfo('conn-1');
      expect(info?.remaining).toBe(4);
    });

    it('should get global info', () => {
      middleware.recordGlobalRequest();
      const info = middleware.getGlobalInfo();
      expect(info.remaining).toBe(19);
    });

    it('should get IP info', () => {
      middleware.recordIPRequest('192.168.1.1');
      const info = middleware.getIPInfo('192.168.1.1');
      expect(info?.remaining).toBe(9);
    });

    it('should get connection count', () => {
      middleware.checkConnection('conn-1');
      middleware.checkConnection('conn-2');
      middleware.checkConnection('conn-3');

      expect(middleware.getConnectionCount()).toBe(3);
    });

    it('should get IP count', () => {
      middleware.checkIP('192.168.1.1');
      middleware.checkIP('192.168.1.2');

      expect(middleware.getIPCount()).toBe(2);
    });
  });

  describe('cleanupStaleLimiters', () => {
    it('should cleanup expired limiters', async () => {
      const shortMiddleware = new RateLimitMiddleware(defaultWebSocketConfig, {
        connectionLimit: 5,
        connectionWindow: 10, // 10ms window
        ipLimit: 10,
        ipWindow: 10,
      });

      shortMiddleware.checkConnection('conn-1');
      shortMiddleware.checkIP('192.168.1.1');

      expect(shortMiddleware.getConnectionCount()).toBe(1);
      expect(shortMiddleware.getIPCount()).toBe(1);

      await new Promise((r) => setTimeout(r, 15));

      const cleaned = shortMiddleware.cleanupStaleLimiters();
      expect(cleaned).toBe(2);
      expect(shortMiddleware.getConnectionCount()).toBe(0);
      expect(shortMiddleware.getIPCount()).toBe(0);

      shortMiddleware.shutdown();
    });
  });

  describe('removeConnection', () => {
    it('should remove connection limiter', () => {
      middleware.checkConnection('conn-1');
      expect(middleware.getConnectionCount()).toBe(1);

      middleware.removeConnection('conn-1');
      expect(middleware.getConnectionCount()).toBe(0);
    });
  });

  describe('shutdown', () => {
    it('should cleanup resources', () => {
      middleware.checkConnection('conn-1');
      middleware.checkIP('192.168.1.1');

      middleware.shutdown();

      expect(middleware.getConnectionCount()).toBe(0);
      expect(middleware.getIPCount()).toBe(0);
    });
  });
});

describe('createRateLimitMiddleware', () => {
  it('should create RateLimitMiddleware instance', () => {
    const middleware = createRateLimitMiddleware();
    expect(middleware).toBeInstanceOf(RateLimitMiddleware);
    middleware.shutdown();
  });

  it('should accept config and options', () => {
    const middleware = createRateLimitMiddleware(defaultWebSocketConfig, {
      connectionLimit: 10,
      globalLimit: 50,
    });

    const result = middleware.checkConnection('conn-1');
    expect(result.info.limit).toBe(10);

    const globalResult = middleware.checkGlobal();
    expect(globalResult.info.limit).toBe(50);

    middleware.shutdown();
  });
});
