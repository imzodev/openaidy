import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import type { BuiltinTool } from '@openaidy/runtime';
import { webFetchMeta } from '../catalog.js';
import { createLogger } from '../../lib/logger.js';

const logger = createLogger('web_fetch');

const MAX_RESPONSE_BYTES = 1024 * 512; // 512 KB
const FETCH_TIMEOUT_MS = 15_000;

const BLOCKED_HOSTS =
  /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1|0\.0\.0\.0)/;
const ALLOWED_PROTOCOLS = ['http:', 'https:'];

/**
 * web_fetch
 *
 * Fetches the content of a URL and returns it to the agent.
 * Supports two formats:
 *  - "text"  (default) — strips HTML and extracts readable text via @mozilla/readability
 *  - "raw"             — returns the raw response body (HTML, JSON, plain text, etc.)
 *
 * Safety measures:
 *  - Only http:// and https:// are allowed
 *  - Private/loopback addresses are blocked (SSRF protection)
 *  - Response size capped at 512 KB
 *  - 15s timeout
 */
export const webFetchTool: BuiltinTool = {
  name: webFetchMeta.name,
  description: webFetchMeta.description,
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to fetch (must start with http:// or https://)',
      },
      format: {
        type: 'string',
        enum: ['text', 'raw'],
        description:
          '"text" (default) strips HTML and returns readable content. "raw" returns the original response body.',
      },
    },
    required: ['url'],
  },
  async execute(args) {
    const url = args['url'];
    const format = (args['format'] as string | undefined) ?? 'text';

    if (typeof url !== 'string' || !url.trim()) {
      return {
        ok: false,
        error: 'url is required and must be a non-empty string',
      };
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, error: `Invalid URL: ${url}` };
    }

    if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
      return {
        ok: false,
        error: `Protocol "${parsed.protocol}" is not allowed. Only http and https are supported.`,
      };
    }

    if (BLOCKED_HOSTS.test(parsed.hostname)) {
      return {
        ok: false,
        error: `Access to host "${parsed.hostname}" is blocked (private/loopback address).`,
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(parsed.toString(), {
        signal: controller.signal,
        headers: {
          'User-Agent': 'OpenAidy/1.0 (web_fetch tool)',
          Accept:
            'text/html,application/xhtml+xml,application/json,text/plain,*/*',
        },
        redirect: 'follow',
      });
    } catch (err) {
      clearTimeout(timeout);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('abort') || msg.includes('signal')) {
        return {
          ok: false,
          error: `Request timed out after ${FETCH_TIMEOUT_MS / 1000}s`,
        };
      }
      return { ok: false, error: `Fetch failed: ${msg}` };
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      return {
        ok: false,
        error: `HTTP ${response.status} ${response.statusText} — ${parsed.toString()}`,
      };
    }

    const contentType = response.headers.get('content-type') ?? '';

    // Read body with size cap
    const reader = response.body?.getReader();
    if (!reader) {
      return { ok: false, error: 'Response body is not readable' };
    }

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    let truncated = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > MAX_RESPONSE_BYTES) {
          chunks.push(
            value.slice(
              0,
              value.byteLength - (totalBytes - MAX_RESPONSE_BYTES),
            ),
          );
          truncated = true;
          reader.cancel();
          break;
        }
        chunks.push(value);
      }
    }

    const rawBody = Buffer.concat(chunks).toString('utf-8');

    if (format === 'raw') {
      return {
        ok: true,
        content: rawBody,
        ...(truncated
          ? { warning: `Response truncated at ${MAX_RESPONSE_BYTES / 1024} KB` }
          : {}),
      };
    }

    // format === 'text' — extract readable content
    const isHtml =
      contentType.includes('text/html') ||
      contentType.includes('application/xhtml') ||
      rawBody.trimStart().startsWith('<!') ||
      rawBody.trimStart().toLowerCase().startsWith('<html');

    if (!isHtml) {
      return {
        ok: true,
        content: rawBody,
        ...(truncated
          ? { warning: `Response truncated at ${MAX_RESPONSE_BYTES / 1024} KB` }
          : {}),
      };
    }

    try {
      const { document } = parseHTML(rawBody);
      const reader = new Readability(document as unknown as Document);
      const article = reader.parse();

      if (article?.textContent) {
        const cleaned = article.textContent.replace(/\s{3,}/g, '\n\n').trim();
        logger.info('HTML parsed successfully', {
          url,
          contentLength: cleaned.length,
        });
        return {
          ok: true,
          content: cleaned,
          title: article.title ?? undefined,
          ...(truncated
            ? {
                warning: `Response truncated at ${MAX_RESPONSE_BYTES / 1024} KB`,
              }
            : {}),
        };
      }
      // article is null or has no textContent - this happens on JavaScript-heavy pages
      logger.error(
        'Readability returned no textContent - page requires JavaScript',
        { url, article: article ? 'parsed but empty' : 'null' },
      );
      return {
        ok: false,
        error: `Failed to extract content from "${parsed.hostname}". This page likely requires JavaScript to render. Try using "format": "raw" for simpler pages, or a different URL that returns pre-rendered content.`,
      };
    } catch (err) {
      // Parsing itself failed
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error('Readability parsing threw an error', {
        url,
        error: errorMessage,
      });
      return {
        ok: false,
        error: `HTML parsing failed for "${parsed.hostname}": ${errorMessage}. Try using "format": "raw" instead.`,
      };
    }
  },
};
