/**
 * Types for AppConfigService
 *
 * Lives in its own file so `service.ts` can stay focused on logic.
 * Per project convention, types and interfaces are exported only
 * from type files and imported wherever they're needed.
 */

import type { McpServerConfig } from '@openaidy/config';
import type { AgentRegistry } from '../agents';
import type { ProviderServices } from '../providers';
import type {
  AuthMethodProvider,
  CredentialProvider,
} from '@openaidy/shared-types';

export type AppConfigIssue = {
  scope: 'provider';
  id: string;
  code: string;
  message: string;
};

export type AppConfigStatus = {
  issues: AppConfigIssue[];
};

export type AppConfigServiceOptions = {
  configPath: string;
  templatePath: string;
  providers: ProviderServices;
  agents: AgentRegistry;
  /**
   * Optional callback that resolves the current credential for a
   * provider at request time. Forwarded to the per-provider config
   * service so OAuth-stored tokens reach upstream APIs.
   */
  credentialProvider?: CredentialProvider;
  /**
   * Optional callback that resolves which auth method a provider's
   * stored credential was connected with. Forwarded alongside
   * `credentialProvider` so adapters that need different request
   * shapes per auth method (Anthropic's OAuth vs API-key headers)
   * can tell them apart.
   */
  authMethodProvider?: AuthMethodProvider;
};

/**
 * Re-export for `McpServerConfig` so consumers of this module don't
 * need to reach into `@openaidy/config` separately.
 */
export type { McpServerConfig };
