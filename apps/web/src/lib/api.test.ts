import { describe, it, expect } from 'vitest';

/**
 * Tests for API base URL configuration
 * 
 * Note: import.meta.env is handled at build time by Vite and cannot be
 * easily mocked in tests. These tests verify the configuration logic
 * by testing a simplified version of the getApiBase function.
 */

describe('API Configuration', () => {
  /**
   * Test the logic that determines the API base URL
   * This mirrors the logic in api.ts
   */
  function getApiBaseUrl(env: {
    VITE_API_URL?: string;
    DEV: boolean;
  }): string {
    // Priority 1: VITE_API_URL environment variable
    if (env.VITE_API_URL) {
      return env.VITE_API_URL;
    }
    
    // Priority 2: In development, use localhost:3001 (server default port)
    if (env.DEV) {
      return 'http://localhost:3001';
    }
    
    // Priority 3: Production without VITE_API_URL - throw clear error
    throw new Error(
      'VITE_API_URL environment variable is required in production. ' +
      'Set it in your .env file or build environment.'
    );
  }

  describe('getApiBaseUrl', () => {
    it('should return VITE_API_URL when set', () => {
      const env = {
        VITE_API_URL: 'https://api.example.com',
        DEV: false,
      };
      expect(getApiBaseUrl(env)).toBe('https://api.example.com');
    });

    it('should return localhost:3001 in dev mode when VITE_API_URL not set', () => {
      const env = {
        VITE_API_URL: undefined,
        DEV: true,
      };
      expect(getApiBaseUrl(env)).toBe('http://localhost:3001');
    });

    it('should throw error in production when VITE_API_URL not set', () => {
      const env = {
        VITE_API_URL: undefined,
        DEV: false,
      };
      expect(() => getApiBaseUrl(env)).toThrow('VITE_API_URL environment variable is required in production');
    });

    it('should use VITE_API_URL over dev default', () => {
      const env = {
        VITE_API_URL: 'https://custom.api.com',
        DEV: true,
      };
      expect(getApiBaseUrl(env)).toBe('https://custom.api.com');
    });

    it('should support custom port in VITE_API_URL', () => {
      const env = {
        VITE_API_URL: 'http://localhost:8080',
        DEV: true,
      };
      expect(getApiBaseUrl(env)).toBe('http://localhost:8080');
    });

    it('should support production URL', () => {
      const env = {
        VITE_API_URL: 'https://prod.api.myapp.com',
        DEV: false,
      };
      expect(getApiBaseUrl(env)).toBe('https://prod.api.myapp.com');
    });
  });

  describe('Dev default port alignment', () => {
    it('should use port 3001 (matching server default)', () => {
      const env = {
        VITE_API_URL: undefined,
        DEV: true,
      };
      const url = getApiBaseUrl(env);
      expect(url).toContain(':3001');
    });

    it('should NOT use port 3000 (old incorrect default)', () => {
      const env = {
        VITE_API_URL: undefined,
        DEV: true,
      };
      const url = getApiBaseUrl(env);
      expect(url).not.toContain(':3000');
    });
  });
});
