import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { webFetchTool } from './fetch';

const mockCtx = { agentId: 'test-agent' };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResponse(opts: {
  ok?: boolean;
  status?: number;
  statusText?: string;
  contentType?: string;
  body?: string;
}): Response {
  const body = opts.body ?? '';
  const encoder = new TextEncoder();
  const encoded = encoder.encode(body);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoded);
      controller.close();
    },
  });

  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    statusText: opts.statusText ?? 'OK',
    headers: new Headers({ 'content-type': opts.contentType ?? 'text/html' }),
    body: stream,
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('web_fetch tool — input validation', () => {
  it('rejects missing url', async () => {
    const result = await webFetchTool.execute({}, mockCtx);
    expect(result.ok).toBe(false);
    expect(String((result as { error: string }).error)).toMatch(
      /url is required/i,
    );
  });

  it('rejects invalid URL', async () => {
    const result = await webFetchTool.execute({ url: 'not-a-url' }, mockCtx);
    expect(result.ok).toBe(false);
    expect(String((result as { error: string }).error)).toMatch(/invalid url/i);
  });

  it('rejects file:// protocol', async () => {
    const result = await webFetchTool.execute(
      { url: 'file:///etc/passwd' },
      mockCtx,
    );
    expect(result.ok).toBe(false);
    expect(String((result as { error: string }).error)).toMatch(/not allowed/i);
  });

  it('rejects ftp:// protocol', async () => {
    const result = await webFetchTool.execute(
      { url: 'ftp://example.com/file' },
      mockCtx,
    );
    expect(result.ok).toBe(false);
    expect(String((result as { error: string }).error)).toMatch(/not allowed/i);
  });

  it('rejects localhost (SSRF)', async () => {
    const result = await webFetchTool.execute(
      { url: 'http://localhost/admin' },
      mockCtx,
    );
    expect(result.ok).toBe(false);
    expect(String((result as { error: string }).error)).toMatch(/blocked/i);
  });

  it('rejects 127.0.0.1 (SSRF)', async () => {
    const result = await webFetchTool.execute(
      { url: 'http://127.0.0.1:8080/' },
      mockCtx,
    );
    expect(result.ok).toBe(false);
    expect(String((result as { error: string }).error)).toMatch(/blocked/i);
  });

  it('rejects 192.168.x.x (SSRF)', async () => {
    const result = await webFetchTool.execute(
      { url: 'http://192.168.1.1/' },
      mockCtx,
    );
    expect(result.ok).toBe(false);
    expect(String((result as { error: string }).error)).toMatch(/blocked/i);
  });

  it('rejects 10.x.x.x (SSRF)', async () => {
    const result = await webFetchTool.execute(
      { url: 'http://10.0.0.1/' },
      mockCtx,
    );
    expect(result.ok).toBe(false);
    expect(String((result as { error: string }).error)).toMatch(/blocked/i);
  });
});

describe('web_fetch tool — HTTP errors', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns error for HTTP 404', async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeResponse({ ok: false, status: 404, statusText: 'Not Found' }),
    );
    const result = await webFetchTool.execute(
      { url: 'https://example.com/missing' },
      mockCtx,
    );
    expect(result.ok).toBe(false);
    expect(String((result as { error: string }).error)).toMatch(/404/);
  });

  it('returns error when fetch throws (network failure)', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await webFetchTool.execute(
      { url: 'https://example.com/' },
      mockCtx,
    );
    expect(result.ok).toBe(false);
    expect(String((result as { error: string }).error)).toMatch(
      /fetch failed/i,
    );
  });
});

describe('web_fetch tool — format: raw', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns raw body for JSON response', async () => {
    const json = JSON.stringify({ hello: 'world' });
    vi.mocked(fetch).mockResolvedValue(
      makeResponse({ contentType: 'application/json', body: json }),
    );
    const result = await webFetchTool.execute(
      { url: 'https://api.example.com/data', format: 'raw' },
      mockCtx,
    );
    expect(result.ok).toBe(true);
    expect((result as { content: string }).content).toBe(json);
  });

  it('returns raw HTML when format is raw', async () => {
    const html = '<html><body><p>Hello</p></body></html>';
    vi.mocked(fetch).mockResolvedValue(makeResponse({ body: html }));
    const result = await webFetchTool.execute(
      { url: 'https://example.com/', format: 'raw' },
      mockCtx,
    );
    expect(result.ok).toBe(true);
    expect((result as { content: string }).content).toBe(html);
  });
});

describe('web_fetch tool — format: text (HTML extraction)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('extracts text from a simple HTML page', async () => {
    const html = `<!DOCTYPE html><html><head><title>Test Page</title></head>
      <body><article><h1>Hello World</h1><p>This is a test article with enough content to be extracted by Readability properly.</p></article></body></html>`;
    vi.mocked(fetch).mockResolvedValue(makeResponse({ body: html }));
    const result = await webFetchTool.execute(
      { url: 'https://example.com/article', format: 'text' },
      mockCtx,
    );
    expect(result.ok).toBe(true);
    const content = (result as { content: string }).content;
    expect(content).toContain('Hello World');
    expect(content).not.toContain('<h1>');
    expect(content).not.toContain('<article>');
  });

  it('returns plain text as-is (non-HTML content type)', async () => {
    const text = 'Just some plain text content.';
    vi.mocked(fetch).mockResolvedValue(
      makeResponse({ contentType: 'text/plain', body: text }),
    );
    const result = await webFetchTool.execute(
      { url: 'https://example.com/readme.txt' },
      mockCtx,
    );
    expect(result.ok).toBe(true);
    expect((result as { content: string }).content).toBe(text);
  });
});
