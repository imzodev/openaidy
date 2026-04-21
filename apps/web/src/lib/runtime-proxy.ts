/**
 * Runtime Proxy
 *
 * Backend communication layer for addon runtime API.
 * Handles HTTP requests, authentication, error transformation, and retry logic.
 */

import type {
  AgentInvocationResult,
  AgentInvokeOptions,
  Session,
  CreateSessionConfig,
  ListSessionsOptions,
} from './addon-types';

// ============================================================================
// Error Types
// ============================================================================

/**
 * Runtime proxy error
 */
export class RuntimeProxyError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly retryable: boolean;
  public readonly details?: unknown;

  constructor(
    message: string,
    code: string,
    status: number,
    retryable: boolean = false,
    details?: unknown,
  ) {
    super(message);
    this.name = 'RuntimeProxyError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.details = details;
  }
}

/**
 * Error codes
 */
export const RuntimeProxyErrorCodes = {
  AUTHENTICATION_FAILED: 'AUTHENTICATION_FAILED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
  SERVER_ERROR: 'SERVER_ERROR',
  TIMEOUT: 'TIMEOUT',
  RATE_LIMITED: 'RATE_LIMITED',
} as const;

// ============================================================================
// Configuration
// ============================================================================

/**
 * Runtime proxy configuration
 */
export interface RuntimeProxyConfig {
  /** Base URL for API */
  baseUrl: string;
  /** Request timeout in ms */
  timeout?: number;
  /** Maximum retries for retryable errors */
  maxRetries?: number;
  /** Retry delay in ms */
  retryDelay?: number;
  /** Enable request logging */
  debug?: boolean;
}

// ============================================================================
// Request/Response Types
// ============================================================================

/**
 * API error response
 */
interface APIErrorResponse {
  error: string;
  message: string;
  details?: unknown;
}

/**
 * Invoke agent request
 */
interface InvokeAgentRequest {
  input: string;
  context?: Record<string, unknown>;
  sessionId?: string;
}

/**
 * Create session request
 */
interface CreateSessionRequest {
  title?: string;
  context?: Record<string, unknown>;
}

// ============================================================================
// Runtime Proxy
// ============================================================================

/**
 * Runtime Proxy
 *
 * Handles all HTTP communication between addons and the backend.
 */
export class RuntimeProxy {
  private baseUrl: string;
  private timeout: number;
  private maxRetries: number;
  private retryDelay: number;
  private debug: boolean;

  constructor(config: RuntimeProxyConfig) {
    this.baseUrl = config.baseUrl;
    this.timeout = config.timeout ?? 30000;
    this.maxRetries = config.maxRetries ?? 3;
    this.retryDelay = config.retryDelay ?? 1000;
    this.debug = config.debug ?? false;
  }

  // ==========================================================================
  // Agent Operations
  // ==========================================================================

  /**
   * Invoke an agent
   */
  async invokeAgent(
    addonAccessToken: string,
    agentId: string,
    input: string,
    options?: AgentInvokeOptions,
  ): Promise<AgentInvocationResult> {
    const request: InvokeAgentRequest = {
      input,
      context: options?.context,
      sessionId: options?.sessionId,
    };

    return this.request<AgentInvocationResult>(
      'POST',
      `/api/addon-proxy/agents/${agentId}/invoke`,
      addonAccessToken,
      request,
    );
  }

  /**
   * List available agents for this addon
   */
  async listAgents(addonAccessToken: string): Promise<{
    agents: Array<{
      id: string;
      name: string;
      description?: string;
    }>;
  }> {
    return this.request('GET', '/api/addon-proxy/agents', addonAccessToken);
  }

  // ==========================================================================
  // Session Operations
  // ==========================================================================

  /**
   * List sessions
   */
  async listSessions(
    addonAccessToken: string,
    options?: ListSessionsOptions,
  ): Promise<{ sessions: Session[] }> {
    const params = new URLSearchParams();
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.offset) params.set('offset', String(options.offset));
    if (options?.status) params.set('status', options.status);

    const query = params.toString();
    const path = query
      ? `/api/addon-proxy/sessions?${query}`
      : '/api/addon-proxy/sessions';

    return this.request('GET', path, addonAccessToken);
  }

  /**
   * Get a session
   */
  async getSession(
    addonAccessToken: string,
    sessionId: string,
  ): Promise<{ session: Session }> {
    return this.request(
      'GET',
      `/api/addon-proxy/sessions/${sessionId}`,
      addonAccessToken,
    );
  }

  /**
   * Create a session
   */
  async createSession(
    addonAccessToken: string,
    config: CreateSessionConfig,
  ): Promise<{ session: Session }> {
    const request: CreateSessionRequest = {
      title: config.title,
      context: config.context,
    };

    return this.request(
      'POST',
      '/api/addon-proxy/sessions',
      addonAccessToken,
      request,
    );
  }

  /**
   * Delete a session
   */
  async deleteSession(
    addonAccessToken: string,
    sessionId: string,
  ): Promise<void> {
    await this.request(
      'DELETE',
      `/api/addon-proxy/sessions/${sessionId}`,
      addonAccessToken,
    );
  }

  // ==========================================================================
  // Config Operations
  // ==========================================================================

  /**
   * Get configuration
   */
  async getConfig(
    addonAccessToken: string,
    namespace: string,
  ): Promise<{ config: Record<string, unknown> }> {
    return this.request(
      'GET',
      `/api/addon-proxy/config/${namespace}`,
      addonAccessToken,
    );
  }

  /**
   * Set configuration
   */
  async setConfig(
    addonAccessToken: string,
    namespace: string,
    config: Record<string, unknown>,
  ): Promise<void> {
    await this.request(
      'PUT',
      `/api/addon-proxy/config/${namespace}`,
      addonAccessToken,
      { config },
    );
  }

  // ==========================================================================
  // Health Check
  // ==========================================================================

  /**
   * Check if the proxy is available
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.request<{ status: string }>(
        'GET',
        '/api/addon-proxy/health',
        undefined,
      );
      return true;
    } catch {
      return false;
    }
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Make an authenticated API request
   */
  private async request<T>(
    method: string,
    path: string,
    token: string | undefined,
    body?: unknown,
    attempt: number = 1,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    if (this.debug) {
      console.debug(`[RuntimeProxy] ${method} ${url}`, { body, attempt });
    }

    let controller: AbortController | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      controller = new AbortController();

      // Set up timeout
      timeoutId = setTimeout(() => controller!.abort(), this.timeout);

      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (this.debug) {
        console.debug(`[RuntimeProxy] Response ${response.status}`, {
          ok: response.ok,
        });
      }

      // Handle error responses
      if (!response.ok) {
        const error = await this.parseErrorResponse(response);
        throw error;
      }

      // Handle empty responses
      const text = await response.text();
      if (!text) {
        return {} as unknown as T;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = JSON.parse(text) as any;
      if (data.data !== undefined) {
        return data.data as T;
      }
      return data as T;
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId);

      // Handle abort (timeout)
      if (error instanceof DOMException && error.name === 'AbortError') {
        const proxyError = new RuntimeProxyError(
          'Request timed out',
          RuntimeProxyErrorCodes.TIMEOUT,
          408,
          true,
        );
        throw proxyError;
      }

      // Handle network errors
      if (error instanceof TypeError && error.message.includes('fetch')) {
        const proxyError = new RuntimeProxyError(
          'Network error',
          RuntimeProxyErrorCodes.NETWORK_ERROR,
          0,
          true,
        );
        throw proxyError;
      }

      // Re-throw RuntimeProxyError
      if (error instanceof RuntimeProxyError) {
        throw error;
      }

      // Check if retryable
      if (
        error instanceof RuntimeProxyError &&
        error.retryable &&
        attempt < this.maxRetries
      ) {
        if (this.debug) {
          console.debug(
            `[RuntimeProxy] Retrying request (attempt ${attempt + 1})`,
          );
        }
        await this.delay(this.retryDelay * attempt);
        return this.request<T>(method, path, token, body, attempt + 1);
      }

      throw error;
    }
  }

  /**
   * Parse error response from API
   */
  private async parseErrorResponse(
    response: Response,
  ): Promise<RuntimeProxyError> {
    let message = 'Request failed';
    let details: unknown;

    try {
      const errorBody = (await response.json()) as APIErrorResponse;
      message = errorBody.message || errorBody.error || message;
      details = errorBody.details;
    } catch {
      // Use default message
    }

    const code = this.getErrorCode(response.status);
    const retryable = this.isRetryableStatus(response.status);

    return new RuntimeProxyError(
      message,
      code,
      response.status,
      retryable,
      details,
    );
  }

  /**
   * Map HTTP status to error code
   */
  private getErrorCode(status: number): string {
    switch (status) {
      case 401:
        return RuntimeProxyErrorCodes.AUTHENTICATION_FAILED;
      case 403:
        return RuntimeProxyErrorCodes.PERMISSION_DENIED;
      case 404:
        return RuntimeProxyErrorCodes.NOT_FOUND;
      case 400:
        return RuntimeProxyErrorCodes.VALIDATION_ERROR;
      case 429:
        return RuntimeProxyErrorCodes.RATE_LIMITED;
      case 500:
      case 502:
      case 503:
        return RuntimeProxyErrorCodes.SERVER_ERROR;
      default:
        return 'UNKNOWN_ERROR';
    }
  }

  /**
   * Check if status code is retryable
   */
  private isRetryableStatus(status: number): boolean {
    return status === 429 || status === 500 || status === 502 || status === 503;
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Factory
// ============================================================================

let globalProxy: RuntimeProxy | undefined;

/**
 * Get or create the global runtime proxy instance
 */
export function getRuntimeProxy(config?: RuntimeProxyConfig): RuntimeProxy {
  if (!globalProxy && config) {
    globalProxy = new RuntimeProxy(config);
  }
  if (!globalProxy) {
    throw new Error(
      'Runtime proxy not configured. Provide config on first call.',
    );
  }
  return globalProxy;
}

/**
 * Set the global runtime proxy (for testing)
 */
export function setRuntimeProxy(proxy: RuntimeProxy): void {
  globalProxy = proxy;
}

/**
 * Reset the global runtime proxy
 */
export function resetRuntimeProxy(): void {
  globalProxy = undefined;
}
