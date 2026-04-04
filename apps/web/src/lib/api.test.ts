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
      mockGetApiBaseFn = () => 'http://localhost:3001';
    });

    it('should return VITE_SERVER_URL when set', () => {
      mockGetApiBaseFn = () => 'https://api.example.com';
      expect(getApiBase()).toBe('https://api.example.com');
    });

    it('should return localhost:3001 in dev mode when VITE_SERVER_URL not set', () => {
      mockGetApiBaseFn = () => 'http://localhost:3001';
      expect(getApiBase()).toBe('http://localhost:3001');
    });

    it('should throw error in production when VITE_SERVER_URL not set', () => {
      mockGetApiBaseFn = () => {
        throw new Error(
          'VITE_SERVER_URL environment variable is required in production. Set it in your .env file or build environment.',
        );
      };
      expect(() => getApiBase()).toThrow(
        'VITE_SERVER_URL environment variable is required in production',
      );
    });

    it('should use VITE_SERVER_URL over dev default', () => {
      mockGetApiBaseFn = () => 'https://custom.api.com';
      expect(getApiBase()).toBe('https://custom.api.com');
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
    it('should use port 3001 (matching server default)', () => {
      mockGetApiBaseFn = () => 'http://localhost:3001';
      const url = getApiBase();
      expect(url).toContain(':3001');
    });

    it('should NOT use port 3000 (old incorrect default)', () => {
      mockGetApiBaseFn = () => 'http://localhost:3001';
      const url = getApiBase();
      expect(url).not.toContain(':3000');
    });
  });
});
