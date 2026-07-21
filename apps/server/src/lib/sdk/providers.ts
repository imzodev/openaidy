/**
 * Provider Connection SDK
 *
 * Client SDK for provider connection operations.
 * Wraps the REST API calls for connecting/disconnecting providers.
 */

import type {
  ProviderInfo,
  AuthMethod,
  ConnectProviderResponse,
  OAuthStartResponse,
  OAuthCompleteResult,
  DeviceCodeResponse,
  ConnectedProvider,
} from '@openaidy/shared-types';

/**
 * Provider SDK client
 *
 * Provides methods for provider connection operations.
 * Used by CLI, web UI, and desktop apps to manage provider connections.
 */
export class ProviderSDK {
  constructor(private readonly baseUrl: string) {}

  /**
   * List available providers with their connection status
   */
  async list(): Promise<{ providers: ProviderInfo[] }> {
    const response = await fetch(`${this.baseUrl}/providers/connection`);
    if (!response.ok) {
      throw new Error(`Failed to list providers: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Get available authentication methods for a provider
   */
  async authMethods(providerId: string): Promise<{
    providerId: string;
    authMethods: AuthMethod[];
  }> {
    const response = await fetch(
      `${this.baseUrl}/providers/${providerId}/auth-methods`,
    );
    if (!response.ok) {
      throw new Error(
        `Failed to get auth methods for ${providerId}: ${response.statusText}`,
      );
    }
    return response.json();
  }

  /**
   * Connect a provider using an API key
   */
  async connect(
    providerId: string,
    apiKey: string,
  ): Promise<ConnectProviderResponse> {
    const response = await fetch(
      `${this.baseUrl}/providers/${providerId}/connect/api-key`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      },
    );
    const result = await response.json();
    return result as ConnectProviderResponse;
  }

  /**
   * Start OAuth flow (returns authorization URL)
   */
  async startOAuth(
    providerId: string,
    redirectUri: string,
  ): Promise<OAuthStartResponse> {
    const response = await fetch(
      `${this.baseUrl}/providers/${providerId}/connect/oauth/start`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ redirectUri }),
      },
    );
    const result = await response.json();
    return result as OAuthStartResponse;
  }

  /**
   * Complete OAuth flow (after user authorizes)
   */
  async completeOAuth(
    providerId: string,
    code: string,
  ): Promise<OAuthCompleteResult> {
    const response = await fetch(
      `${this.baseUrl}/providers/${providerId}/connect/oauth/callback?code=${encodeURIComponent(code)}`,
    );
    const result = await response.json();
    return result as OAuthCompleteResult;
  }

  /**
   * Start device code flow (for CLI/Desktop apps)
   */
  async startDeviceCode(providerId: string): Promise<DeviceCodeResponse> {
    const response = await fetch(
      `${this.baseUrl}/providers/${providerId}/connect/device-code/start`,
      { method: 'POST' },
    );
    const result = await response.json();
    return result as DeviceCodeResponse;
  }

  /**
   * Poll for device code authorization completion
   */
  async pollDeviceCode(
    providerId: string,
    deviceCode: string,
  ): Promise<{
    pending?: boolean;
    accessToken?: string;
    refreshToken?: string;
    expiresIn?: number;
    error?: string;
  }> {
    const response = await fetch(
      `${this.baseUrl}/providers/${providerId}/connect/device-code/poll`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceCode }),
      },
    );
    const result = await response.json();
    return result;
  }

  /**
   * Disconnect a provider
   */
  async disconnect(providerId: string): Promise<{ success: boolean }> {
    const response = await fetch(
      `${this.baseUrl}/providers/${providerId}/connection`,
      { method: 'DELETE' },
    );
    const result = await response.json();
    return result as { success: boolean };
  }

  /**
   * List connected providers
   */
  async connected(): Promise<{ providers: ConnectedProvider[] }> {
    const response = await fetch(`${this.baseUrl}/providers/connection`);
    if (!response.ok) {
      throw new Error(
        `Failed to list connected providers: ${response.statusText}`,
      );
    }
    return response.json();
  }
}
