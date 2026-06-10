import type { DatabaseClient } from '@openaidy/db';
import type {
  ProviderInfo,
  ConnectedProvider,
  ConnectProviderResponse,
  OAuthStartResponse,
  OAuthCompleteResult,
  DeviceCodeResponse,
  AuthMethod,
  ProviderConnectionStatus,
} from '@openaidy/shared-types';
import { registry as providerRegistry } from '@openaidy/providers';
import { ProviderCredentialsRepository } from '@openaidy/db';
import { getEncryptionService } from '../lib/encryption.js';

/**
 * Provider Connection Service
 *
 * Handles provider connection workflows including:
 * - Listing available providers
 * - Connecting with API key
 * - OAuth/device code flows
 * - Credential storage and retrieval
 */
export class ProviderConnectionService {
  private readonly credentialsRepo: ProviderCredentialsRepository;
  private readonly encryption = getEncryptionService();

  constructor(db: DatabaseClient) {
    this.credentialsRepo = new ProviderCredentialsRepository(db);
  }

  /**
   * List all available providers with their auth methods
   */
  listAvailableProviders(): ProviderInfo[] {
    const profiles = providerRegistry.list();

    return profiles.map((profile) => {
      const isConnected = this.isProviderConnected(profile.id);
      const result: ProviderInfo = {
        id: profile.id,
        displayName: profile.displayName ?? profile.name,
        icon: profile.getIcon(),
        vendorFamily: profile.vendorFamily ?? 'openai-compatible',
        availableAuthMethods: profile.getAvailableAuthMethods(),
        isConnected,
      };
      if (profile.description) result.description = profile.description;
      if (profile.signupUrl) result.signupUrl = profile.signupUrl;
      if (isConnected) result.connectionStatus = 'connected';
      return result;
    });
  }

  /**
   * Get auth methods for a specific provider
   */
  getAuthMethods(providerId: string): AuthMethod[] {
    const profile = providerRegistry.get(providerId);
    if (!profile) {
      throw new Error(`Provider ${providerId} not found`);
    }
    return profile.getAvailableAuthMethods();
  }

  /**
   * Connect provider with API key
   */
  async connectWithApiKey(
    providerId: string,
    apiKey: string,
  ): Promise<ConnectProviderResponse> {
    const profile = providerRegistry.get(providerId);
    if (!profile) {
      return { success: false, error: `Provider ${providerId} not found` };
    }

    // Validate API key
    const validation = await profile.validateApiKey(apiKey);
    if (!validation.valid) {
      return { success: false, error: validation.error ?? 'Invalid API key' };
    }

    // Encrypt and store credentials
    const encrypted = this.encryption.encrypt(apiKey);
    const credential = await this.credentialsRepo.upsert(
      providerId,
      'api_key',
      encrypted,
    );

    return {
      success: true,
      provider: {
        providerId,
        workspaceId: '',
        status: 'connected',
        authMethod: 'api_key',
        connectedAt: credential.createdAt.toISOString(),
      },
    };
  }

  /**
   * Start OAuth flow
   */
  async startOAuthFlow(
    providerId: string,
    redirectUri: string,
  ): Promise<OAuthStartResponse> {
    const profile = providerRegistry.get(providerId);
    if (!profile) {
      throw new Error(`Provider ${providerId} not found`);
    }

    const authUrl = profile.getOAuthAuthorizationUrl();
    if (!authUrl) {
      throw new Error(`Provider ${providerId} does not support OAuth`);
    }

    // Generate state for CSRF protection
    const state = this.generateState();

    return {
      authorizationUrl: `${authUrl}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`,
      state,
    };
  }

  /**
   * Start device code flow (for CLI)
   */
  async startDeviceCodeFlow(providerId: string): Promise<DeviceCodeResponse> {
    const profile = providerRegistry.get(providerId);
    if (!profile) {
      throw new Error(`Provider ${providerId} not found`);
    }

    const deviceCodeInfo = profile.getDeviceCodeInfo();
    if (!deviceCodeInfo) {
      throw new Error(
        `Provider ${providerId} does not support device code flow`,
      );
    }

    return deviceCodeInfo;
  }

  /**
   * Complete OAuth flow
   */
  async completeOAuthFlow(
    providerId: string,
    code: string,
    redirectUri: string,
  ): Promise<OAuthCompleteResult> {
    const profile = providerRegistry.get(providerId);
    if (!profile) {
      return {
        success: false,
        providerId,
        error: `Provider ${providerId} not found`,
      };
    }

    const result = await profile.exchangeOAuthCode(code, redirectUri);
    if (result.error) {
      return { success: false, providerId, error: result.error };
    }

    // Encrypt and store tokens
    const encryptedTokens = this.encryption.encrypt(
      JSON.stringify({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresAt: result.expiresIn
          ? Date.now() + result.expiresIn * 1000
          : undefined,
      }),
    );

    await this.credentialsRepo.upsert(providerId, 'oauth', encryptedTokens);

    return { success: true, providerId };
  }

  /**
   * Poll for device code authorization
   */
  async pollDeviceCodeAuth(
    providerId: string,
    deviceCode: string,
  ): Promise<{
    pending?: boolean;
    accessToken?: string;
    refreshToken?: string;
    expiresIn?: number;
    error?: string;
  }> {
    const profile = providerRegistry.get(providerId);
    if (!profile) {
      return { error: `Provider ${providerId} not found` };
    }

    return profile.pollDeviceCodeAuth(deviceCode);
  }

  /**
   * Disconnect provider
   */
  async disconnect(providerId: string): Promise<boolean> {
    return this.credentialsRepo.delete(providerId);
  }

  /**
   * List connected providers
   */
  async listConnectedProviders(): Promise<ConnectedProvider[]> {
    const credentials = await this.credentialsRepo.listConnected();

    return credentials.map((cred) => {
      const result: ConnectedProvider = {
        providerId: cred.providerId,
        workspaceId: '',
        status: cred.status as ProviderConnectionStatus,
        authMethod: cred.authMethod as 'api_key' | 'oauth' | 'device_code',
        connectedAt: cred.createdAt.toISOString(),
      };
      if (cred.lastUsedAt) result.lastUsedAt = cred.lastUsedAt.toISOString();
      if (cred.errorMessage) result.error = cred.errorMessage;
      return result;
    });
  }

  /**
   * Get decrypted credentials for a provider
   */
  async getCredentials(providerId: string): Promise<string | null> {
    const credential = await this.credentialsRepo.findByProviderId(providerId);
    if (!credential) return null;

    await this.credentialsRepo.updateLastUsed(credential.id);
    return this.encryption.decrypt(credential.encryptedCredentials);
  }

  /**
   * Check if provider is connected (sync check)
   */
  private isProviderConnected(providerId: string): boolean {
    // Note: This is a sync check - in production would be async
    const cred = this.credentialsRepo.findByProviderId(providerId);
    return cred !== null;
  }

  /**
   * Generate random state for OAuth CSRF protection
   */
  private generateState(): string {
    return (
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15)
    );
  }
}
