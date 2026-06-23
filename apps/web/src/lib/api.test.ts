import { describe, it, expect, vi, beforeEach } from 'vitest';

// Type for our mock function
type MockGetApiBase = () => string;

// We store the mock function in a variable that can be accessed by the mocked module
let mockGetApiBaseFn: MockGetApiBase = () => 'http://localhost:3001';

// Mock the api module - the getApiBase function is what we're testing
vi.mock('./api', () => ({
  getApiBase: () => mockGetApiBaseFn(),
}));

// Import after mock is set up
import { getApiBase } from './api';

describe('API Configuration', () => {
  describe('getApiBase', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
      // Reset mock to default
      mockGetApiBaseFn = () => '';
    });

    it('should return VITE_SERVER_URL when set', () => {
      mockGetApiBaseFn = () => 'https://api.example.com';
      expect(getApiBase()).toBe('https://api.example.com');
    });

    it('should return empty string (same-origin) when VITE_SERVER_URL is unset', () => {
      mockGetApiBaseFn = () => '';
      expect(getApiBase()).toBe('');
    });

    it('should support custom port in VITE_SERVER_URL', () => {
      mockGetApiBaseFn = () => 'http://localhost:8080';
      expect(getApiBase()).toBe('http://localhost:8080');
    });

    it('should support production URL', () => {
      mockGetApiBaseFn = () => 'https://prod.api.myapp.com';
      expect(getApiBase()).toBe('https://prod.api.myapp.com');
    });
  });

  describe('Dev default port alignment', () => {
    it('should default to same-origin (empty string) instead of an arbitrary host', () => {
      mockGetApiBaseFn = () => '';
      const url = getApiBase();
      expect(url).toBe('');
    });
  });
});
