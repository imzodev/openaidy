import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(global, 'localStorage', { value: localStorageMock });

import {
  getTokenFromUrl,
  consumeTokenFromUrl,
  getStoredToken,
  storeToken,
  clearToken,
  resolveToken,
} from './auth-token';

const STORAGE_KEY = 'openaidy_auth_token';

describe('auth-token', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  describe('getTokenFromUrl', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('returns token from ?token= param', () => {
      vi.stubGlobal('window', {
        location: { search: '?token=abc123' },
      });
      expect(getTokenFromUrl()).toBe('abc123');
    });

    it('returns undefined when no token param', () => {
      vi.stubGlobal('window', {
        location: { search: '' },
      });
      expect(getTokenFromUrl()).toBeUndefined();
    });

    it('returns undefined when window is undefined', () => {
      vi.stubGlobal('window', undefined);
      expect(getTokenFromUrl()).toBeUndefined();
    });
  });

  describe('getStoredToken', () => {
    it('returns stored token from localStorage', () => {
      localStorageMock.setItem(STORAGE_KEY, 'stored-token');
      expect(getStoredToken()).toBe('stored-token');
    });

    it('returns undefined when no token stored', () => {
      expect(getStoredToken()).toBeUndefined();
    });
  });

  describe('consumeTokenFromUrl', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('returns the URL token and strips it from the address bar', () => {
      const replaceState = vi.fn();
      vi.stubGlobal('window', {
        location: {
          href: 'http://localhost:3001/?token=abc123',
          search: '?token=abc123',
        },
        history: { replaceState },
      });
      vi.stubGlobal('document', { title: 'OpenAidy' });

      expect(consumeTokenFromUrl()).toBe('abc123');
      expect(replaceState).toHaveBeenCalledTimes(1);
      const args = replaceState.mock.calls[0] as [unknown, string, string];
      const cleaned = args[2];
      expect(cleaned).toBe('/');
    });

    it('returns undefined when no token is present', () => {
      const replaceState = vi.fn();
      vi.stubGlobal('window', {
        location: {
          href: 'http://localhost:3001/',
          search: '',
        },
        history: { replaceState },
      });
      vi.stubGlobal('document', { title: 'OpenAidy' });

      expect(consumeTokenFromUrl()).toBeUndefined();
      expect(replaceState).not.toHaveBeenCalled();
    });

    it('preserves other query params when stripping the token', () => {
      const replaceState = vi.fn();
      vi.stubGlobal('window', {
        location: {
          href: 'http://localhost:3001/?foo=bar&token=abc123&baz=qux',
          search: '?foo=bar&token=abc123&baz=qux',
        },
        history: { replaceState },
      });
      vi.stubGlobal('document', { title: 'OpenAidy' });

      expect(consumeTokenFromUrl()).toBe('abc123');
      const args = replaceState.mock.calls[0] as [unknown, string, string];
      const cleaned = args[2];
      expect(cleaned).toContain('foo=bar');
      expect(cleaned).toContain('baz=qux');
      expect(cleaned).not.toContain('token=abc123');
    });

    it('returns undefined when window is undefined', () => {
      vi.stubGlobal('window', undefined);
      expect(consumeTokenFromUrl()).toBeUndefined();
    });
  });

  describe('storeToken', () => {
    it('persists token to localStorage', () => {
      storeToken('my-token');
      expect(localStorageMock.getItem(STORAGE_KEY)).toBe('my-token');
    });
  });

  describe('clearToken', () => {
    it('removes token from localStorage', () => {
      localStorageMock.setItem(STORAGE_KEY, 'to-remove');
      clearToken();
      expect(localStorageMock.getItem(STORAGE_KEY)).toBeNull();
    });
  });

  describe('resolveToken', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('prefers URL param over localStorage', () => {
      localStorageMock.setItem(STORAGE_KEY, 'stored-token');
      vi.stubGlobal('window', {
        location: { search: '?token=url-token' },
      });
      expect(resolveToken()).toBe('url-token');
    });

    it('falls back to localStorage when no URL param', () => {
      localStorageMock.setItem(STORAGE_KEY, 'stored-token');
      vi.stubGlobal('window', {
        location: { search: '' },
      });
      expect(resolveToken()).toBe('stored-token');
    });

    it('returns undefined when neither URL param nor localStorage', () => {
      vi.stubGlobal('window', {
        location: { search: '' },
      });
      expect(resolveToken()).toBeUndefined();
    });
  });
});
