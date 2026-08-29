import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import {
  appConfigSchema,
  envSecret,
  type AppProviderConfig,
  type ChannelConfig,
  type McpServerConfig,
  type OpenAidyAppConfig,
  type ProviderConfig,
  providerConfigSchema,
} from '@openaidy/config';
import type { AgentRegistry } from '../agents';
import type { Agent } from '../agents';
import type { ProviderServices } from '../providers';
import { createProviderConfigService } from '../providers/config-service';
import type {
  AppConfigIssue,
  AppConfigServiceOptions,
  AppConfigStatus,
} from './types';
import type { CredentialProvider } from '@openaidy/shared-types';
import {
  MCP_SEED_MANIFEST_FILE,
  reconcilePreinstalledMcpServers,
  readMcpSeedManifest,
  writeMcpSeedManifest,
} from '../mcp/preinstall';
import { encryptSecret, isEncryptedSecret } from '../mcp/secret-crypto';

export class AppConfigService {
  private readonly configPath: string;
  private readonly templatePath: string;
  private readonly providers: ProviderServices;
  private readonly agents: AgentRegistry;
  private readonly credentialProvider: CredentialProvider | undefined;
  private currentConfig: OpenAidyAppConfig | undefined;
  private issues: AppConfigIssue[] = [];
  private channelReconciler:
    | ((channels: ChannelConfig[] | undefined) => void | Promise<void>)
    | undefined;

  constructor(options: AppConfigServiceOptions) {
    this.configPath = options.configPath;
    this.templatePath = options.templatePath;
    this.providers = options.providers;
    this.agents = options.agents;
    this.credentialProvider = options.credentialProvider;
  }

  /**
   * Register a callback that syncs the live channel registry to the persisted
   * `config.channels` after every {@link save}. Set once at startup (the
   * registry is built after this service is constructed, hence a setter rather
   * than a constructor option). Without it, a channel added/removed via the
   * config PUT would not take effect until a restart. Kept as an injected
   * callback so this config module stays free of channel/WhatsApp internals.
   */
  setChannelReconciler(
    reconcile: (channels: ChannelConfig[] | undefined) => void | Promise<void>,
  ): void {
    this.channelReconciler = reconcile;
  }

  getConfig(): OpenAidyAppConfig {
    if (!this.currentConfig) {
      throw new Error('Application config has not been loaded');
    }

    return this.currentConfig;
  }

  /**
   * Get all MCP server configurations
   */
  getMcpServers(): McpServerConfig[] {
    return this.getConfig().mcpServers ?? [];
  }

  /**
   * Get a specific MCP server configuration by ID
   */
  getMcpServer(id: string): McpServerConfig | undefined {
    return this.getConfig().mcpServers?.find((server) => server.id === id);
  }

  /**
   * Named MCP secrets (e.g. `NOTION_TOKEN`), keyed by the `${VAR}` name they
   * satisfy. Values are encrypted (`enc:v1:...`) once persisted — see
   * `mcp/secret-crypto.ts` — and resolved by `EnvPlaceholderResolver`.
   */
  getMcpSecrets(): Record<string, string> {
    return this.getConfig().mcpSecrets ?? {};
  }

  /** Paste-a-key entry point: encrypts and persists a single named secret. */
  async setMcpSecret(name: string, plaintext: string): Promise<void> {
    await this.save({
      ...this.getConfig(),
      mcpSecrets: {
        ...this.getMcpSecrets(),
        [name]: encryptSecret(plaintext),
      },
    });
  }

  /** Removes a named secret (e.g. so a server falls back to "awaiting configuration"). */
  async deleteMcpSecret(name: string): Promise<void> {
    const { [name]: _removed, ...rest } = this.getMcpSecrets();
    await this.save({ ...this.getConfig(), mcpSecrets: rest });
  }

  getStatus(): AppConfigStatus {
    return {
      issues: [...this.issues],
    };
  }

  /**
   * Add any preinstalled MCP servers from the config template that this install
   * doesn't have yet. The template is only copied on first run, so without this
   * a server added to the template later would never reach existing installs.
   *
   * A newly shipped server is added; a preinstalled server whose template
   * definition changed is updated **only if the user hasn't modified it**;
   * servers the user deleted are remembered and not re-added; user-created or
   * user-edited servers are never clobbered. Persists the config when a server
   * is added or updated, and the manifest whenever it changes. Returns the ids
   * touched. Must be called after {@link load}.
   */
  async reconcilePreinstalledMcpServers(): Promise<{
    added: string[];
    updated: string[];
  }> {
    const templateServers = this.readTemplateMcpServers();
    if (templateServers.length === 0) return { added: [], updated: [] };

    const manifestPath = join(dirname(this.configPath), MCP_SEED_MANIFEST_FILE);
    const manifest = readMcpSeedManifest(manifestPath);

    const result = reconcilePreinstalledMcpServers(
      this.getMcpServers(),
      templateServers,
      manifest,
    );

    if (result.added.length > 0 || result.updated.length > 0) {
      // Persist directly rather than via save(): load() already ran
      // applyConfig (providers, agents), and only mcpServers changed — which
      // applyConfig doesn't touch — so a second full apply would be wasted work
      // at startup. Validate, write, and refresh the in-memory config.
      const nextConfig = appConfigSchema.parse({
        ...this.getConfig(),
        mcpServers: result.servers,
      });
      this.writeConfigFile(nextConfig);
      this.currentConfig = nextConfig;
    }
    if (result.changed) {
      writeMcpSeedManifest(manifestPath, result.manifest);
    }

    return { added: result.added, updated: result.updated };
  }

  /** Read the `mcpServers` shipped in the config template, if any. */
  private readTemplateMcpServers(): McpServerConfig[] {
    if (!existsSync(this.templatePath)) return [];
    try {
      const parsed = appConfigSchema.parse(
        JSON.parse(readFileSync(this.templatePath, 'utf-8')),
      );
      return parsed.mcpServers ?? [];
    } catch {
      return [];
    }
  }

  getPaths(): { configPath: string; templatePath: string } {
    return {
      configPath: this.configPath,
      templatePath: this.templatePath,
    };
  }

  async load(): Promise<OpenAidyAppConfig> {
    this.bootstrapIfMissing();
    const config = this.readConfigFile(this.configPath);
    await this.applyConfig(config);
    this.currentConfig = config;
    return config;
  }

  async save(input: unknown): Promise<OpenAidyAppConfig> {
    const parsed = appConfigSchema.parse(input);
    this.encryptChannelSecrets(parsed);
    this.encryptMcpSecrets(parsed);
    this.writeConfigFile(parsed);
    await this.applyConfig(parsed);
    this.currentConfig = parsed;
    // Sync runtime channels to the freshly-saved config (registers new
    // channels, disconnects+removes deleted ones) so UI changes take effect
    // without a restart. applyConfig handles agents/providers; channels are
    // reconciled here via the injected callback to keep this module decoupled
    // from channel internals.
    if (this.channelReconciler) {
      await this.channelReconciler(parsed.channels);
    }
    return parsed;
  }

  async reload(): Promise<OpenAidyAppConfig> {
    return this.load();
  }

  private bootstrapIfMissing(): void {
    if (existsSync(this.configPath)) {
      return;
    }

    if (!existsSync(this.templatePath)) {
      throw new Error(`Config template not found at ${this.templatePath}`);
    }

    mkdirSync(dirname(this.configPath), { recursive: true });
    copyFileSync(this.templatePath, this.configPath);
  }

  private readConfigFile(filePath: string): OpenAidyAppConfig {
    let parsedJson: unknown;

    try {
      parsedJson = JSON.parse(readFileSync(filePath, 'utf-8'));
    } catch (error) {
      throw new Error(
        `Failed to read app config at ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }

    return appConfigSchema.parse(parsedJson);
  }

  /**
   * Encrypt inline channel secrets (currently the Discord bot token) before
   * the config is written, so a plaintext token pasted in the UI never lands
   * in openaidy.json. Idempotent: already-encrypted (`enc:v1:`) values and
   * env-var references are left untouched. Mirrors MCP inline-secret handling
   * (see `mcp/server-record.ts`).
   */
  private encryptChannelSecrets(config: OpenAidyAppConfig): void {
    for (const channel of config.channels ?? []) {
      if (channel.type !== 'discord') continue;
      const token = channel.botToken;
      if (
        typeof token === 'object' &&
        token.kind === 'inline' &&
        !isEncryptedSecret(token.value)
      ) {
        token.value = encryptSecret(token.value);
      }
    }
  }

  /**
   * Encrypt any plaintext `mcpSecrets` values before the config is written
   * (defensive: `setMcpSecret` always encrypts already, but a config could
   * also be imported/restored with a plaintext value). Idempotent, mirrors
   * {@link encryptChannelSecrets}.
   */
  private encryptMcpSecrets(config: OpenAidyAppConfig): void {
    if (!config.mcpSecrets) return;
    for (const [name, value] of Object.entries(config.mcpSecrets)) {
      if (!isEncryptedSecret(value)) {
        config.mcpSecrets[name] = encryptSecret(value);
      }
    }
  }

  private writeConfigFile(config: OpenAidyAppConfig): void {
    mkdirSync(dirname(this.configPath), { recursive: true });
    const tempPath = `${this.configPath}.tmp`;
    writeFileSync(tempPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
    renameSync(tempPath, this.configPath);
  }

  private async applyConfig(config: OpenAidyAppConfig): Promise<void> {
    this.agents.replaceAll(config.agents as Agent[]);

    this.providers.registry.clear();
    this.issues = [];

    const configService = createProviderConfigService(
      this.credentialProvider
        ? { credentialProvider: this.credentialProvider }
        : {},
    );

    for (const provider of config.providers) {
      if (!provider.enabled) {
        continue;
      }

      const providerConfig = this.toProviderConfig(provider);
      const result = await configService.loadProvider(providerConfig);

      if (!result.ok) {
        this.issues.push({
          scope: 'provider',
          id: provider.id,
          code: result.error.code,
          message: result.error.message,
        });
        continue;
      }

      const registrationOptions: {
        enabled?: boolean;
        priority?: number;
        defaultModel?: string;
        config?: Record<string, unknown>;
      } = {
        enabled: provider.enabled,
        priority: result.config.priority,
      };

      if (result.config.defaultModel !== undefined) {
        registrationOptions.defaultModel = result.config.defaultModel;
      }

      const routeConfig: Record<string, unknown> = {
        modelIds: provider.models
          .filter((model) => model.enabled !== false)
          .map((model) => model.id),
      };
      if (provider.baseUrl !== undefined) {
        routeConfig.baseUrl = provider.baseUrl;
      }
      if (provider.apiKeyEnv !== undefined) {
        routeConfig.apiKeyEnv = provider.apiKeyEnv;
      }
      registrationOptions.config = routeConfig;

      this.providers.registry.register(result.provider, registrationOptions);
    }

    // On a fresh (unconfigured) install both are undefined; only set a default
    // once a default provider is configured and actually registered.
    const { providerId: defaultProviderId, modelId: defaultModelId } =
      config.defaults;
    if (
      defaultProviderId !== undefined &&
      defaultModelId !== undefined &&
      this.providers.registry.has(defaultProviderId)
    ) {
      this.providers.registry.setDefault({
        providerId: defaultProviderId,
        modelId: defaultModelId,
      });
    }
  }

  private toProviderConfig(provider: AppProviderConfig): ProviderConfig {
    const common: Record<string, unknown> = {
      id: provider.id,
      name: provider.name,
      enabled: provider.enabled,
      priority: provider.priority,
    };

    if (provider.defaultModel !== undefined) {
      common.defaultModel = provider.defaultModel;
    }
    if (provider.baseUrl !== undefined) {
      common.baseUrl = provider.baseUrl;
    }
    if (provider.apiKeyEnv !== undefined) {
      common.apiKey = envSecret(provider.apiKeyEnv);
    }
    if (provider.organizationId !== undefined) {
      common.organizationId = provider.organizationId;
    }
    if (provider.timeout !== undefined) {
      common.timeout = provider.timeout;
    }
    if (provider.retry !== undefined) {
      common.retry = provider.retry;
    }
    if (provider.headers !== undefined) {
      common.headers = provider.headers;
    }
    if (provider.metadata !== undefined) {
      common.metadata = provider.metadata;
    }

    const candidate: Record<string, unknown> = {
      ...common,
      vendorFamily: provider.vendorFamily,
    };

    switch (provider.vendorFamily) {
      case 'openai-compatible':
        candidate.useResponsesApi = provider.useResponsesApi;
        candidate.enableTools = provider.enableTools;
        candidate.enableVision = provider.enableVision;
        candidate.enableStreaming = provider.enableStreaming;
        candidate.defaultTemperature = provider.defaultTemperature;
        candidate.defaultMaxTokens = provider.defaultMaxTokens;
        if (provider.chatModel !== undefined) {
          candidate.chatModel = provider.chatModel;
        }
        if (provider.embeddingModel !== undefined) {
          candidate.embeddingModel = provider.embeddingModel;
        }
        if (provider.audioModel !== undefined) {
          candidate.audioModel = provider.audioModel;
        }
        if (provider.imageModel !== undefined) {
          candidate.imageModel = provider.imageModel;
        }
        break;
      case 'anthropic':
        candidate.apiVersion = provider.apiVersion;
        candidate.enableExtendedThinking = provider.enableExtendedThinking;
        candidate.enableTools = provider.enableTools;
        candidate.enableVision = provider.enableVision;
        candidate.enableStreaming = provider.enableStreaming;
        candidate.defaultMaxTokens = provider.defaultMaxTokens;
        candidate.defaultTemperature = provider.defaultTemperature;
        if (provider.messagesModel !== undefined) {
          candidate.messagesModel = provider.messagesModel;
        }
        if (provider.betas !== undefined) {
          candidate.betas = provider.betas;
        }
        if (provider.maxThinkingTokens !== undefined) {
          candidate.maxThinkingTokens = provider.maxThinkingTokens;
        }
        if (provider.systemPrompt !== undefined) {
          candidate.systemPrompt = provider.systemPrompt;
        }
        break;
      case 'gemini':
        candidate.region = provider.region;
        candidate.useVertexAI = provider.useVertexAI;
        candidate.embeddingModel = provider.embeddingModel;
        candidate.enableTools = provider.enableTools;
        candidate.enableVision = provider.enableVision;
        candidate.enableAudioInput = provider.enableAudioInput;
        candidate.enableStreaming = provider.enableStreaming;
        candidate.defaultTemperature = provider.defaultTemperature;
        candidate.defaultMaxTokens = provider.defaultMaxTokens;
        if (provider.projectId !== undefined) {
          candidate.projectId = provider.projectId;
        }
        if (provider.safetySettings !== undefined) {
          candidate.safetySettings = provider.safetySettings;
        }
        if (provider.generationConfig !== undefined) {
          candidate.generationConfig = provider.generationConfig;
        }
        if (provider.systemInstruction !== undefined) {
          candidate.systemInstruction = provider.systemInstruction;
        }
        break;
    }

    return providerConfigSchema.parse(candidate);
  }
}

export function createAppConfigService(
  options: AppConfigServiceOptions,
): AppConfigService {
  return new AppConfigService(options);
}
