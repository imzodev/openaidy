/**
 * Auth token management
 *
 * Priority order:
 * 1. URL param ?token=... (not persisted, one-time use)
 * 2. localStorage persisted token
 */

const STORAGE_KEY = 'openaidy_auth_token';
const URL_TOKEN_PARAM = 'token';

export function getTokenFromUrl(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const params = new URLSearchParams(window.location.search);
  return params.get(URL_TOKEN_PARAM) ?? undefined;
}

/**
 * Read the token from the URL and immediately strip the query parameter so it
 * does not linger in browser history, get re-shared, or get re-consumed if the
 * page is reloaded. Safe to call when there is no token in the URL.
 */
export function consumeTokenFromUrl(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const token = getTokenFromUrl();
  if (!token) return undefined;
  const href = window.location.href;
  const url = new URL(href, href);
  url.searchParams.delete(URL_TOKEN_PARAM);
  const cleaned = url.pathname + url.search + url.hash;
  window.history.replaceState({}, document.title, cleaned);
  return token;
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
