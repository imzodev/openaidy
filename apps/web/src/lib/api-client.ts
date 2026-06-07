// apps/web/src/lib/api-client.ts
import { getServicePort } from './tauri-bridge';

let _baseUrl: string | null = null;

export async function getApiBase(): Promise<string> {
  if (_baseUrl) return _baseUrl;

  // In Tauri, read port from file
  if (typeof window !== 'undefined' && '__TAURI__' in window) {
    const port = await getServicePort();
    _baseUrl = `http://127.0.0.1:${port}`;
  } else {
    // Browser dev mode: localhost:3001
    _baseUrl = 'http://localhost:3001';
  }

  return _baseUrl;
}

// Re-export the api client with dynamic base URL
export async function createApiClient() {
  const baseUrl = await getApiBase();
  return {
    baseUrl,
    async get<T>(path: string): Promise<T> {
      const res = await fetch(`${baseUrl}${path}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
      return res.json();
    },
    async post<T>(path: string, body: unknown): Promise<T> {
      const res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
      return res.json();
    },
  };
}
