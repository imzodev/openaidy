/**
 * Auth token management
 *
 * Priority order:
 * 1. URL param ?token=... (not persisted, one-time use)
 * 2. localStorage persisted token
 */

const STORAGE_KEY = 'openaidy_auth_token';

export function getTokenFromUrl(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const params = new URLSearchParams(window.location.search);
  return params.get('token') ?? undefined;
}

export function getStoredToken(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return localStorage.getItem(STORAGE_KEY) ?? undefined;
}

export function storeToken(token: string): void {
  localStorage.setItem(STORAGE_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function resolveToken(): string | undefined {
  return getTokenFromUrl() ?? getStoredToken();
}
