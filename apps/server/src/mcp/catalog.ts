/**
 * Curated integrations offered in the "Browse integrations" gallery.
 *
 * Unlike the preinstalled servers (config/openaidy.template.json), nothing
 * here is added to a user's config until they pick it. Every `oauth` entry
 * was checked to publish MCP authorization metadata with a dynamic client
 * registration endpoint, so connecting is a single sign-in. `oauth-own-app`
 * providers (Google) don't allow dynamic registration: the user creates an
 * OAuth client in the provider's console and pastes its ID/secret.
 *
 * Servers that require a provider-approved client (HubSpot, Asana, Box,
 * Shopify, Figma) are deliberately left out until OpenAidy has one.
 */

import type { McpServerConfig } from '@openaidy/config';
import type { McpCatalogEntry } from '@openaidy/shared-types';

export type McpCatalogDefinition = Omit<McpCatalogEntry, 'installed'>;

export const MCP_CATALOG: readonly McpCatalogDefinition[] = [
  // Productivity
  {
    id: 'notion',
    name: 'Notion',
    description: 'Search, read and update pages and databases.',
    category: 'productivity',
    setup: 'oauth',
    url: 'https://mcp.notion.com/mcp',
    docsUrl: 'https://developers.notion.com/docs/mcp',
  },
  {
    id: 'linear',
    name: 'Linear',
    description: 'Create and update issues, projects and comments.',
    category: 'productivity',
    setup: 'oauth',
    url: 'https://mcp.linear.app/mcp',
    docsUrl: 'https://linear.app/docs/mcp',
  },
  {
    id: 'atlassian',
    name: 'Jira & Confluence',
    description: 'Work with Jira issues and Confluence pages.',
    category: 'productivity',
    setup: 'oauth',
    url: 'https://mcp.atlassian.com/v1/mcp',
    docsUrl:
      'https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-remote-mcp-server/',
  },
  {
    id: 'monday',
    name: 'monday.com',
    description: 'Manage boards, items and updates.',
    category: 'productivity',
    setup: 'oauth',
    url: 'https://mcp.monday.com/mcp',
    docsUrl: 'https://developer.monday.com/apps/docs/mondaycom-mcp-integration',
  },
  {
    id: 'clickup',
    name: 'ClickUp',
    description: 'Manage tasks, lists and docs.',
    category: 'productivity',
    setup: 'oauth',
    url: 'https://mcp.clickup.com/mcp',
    docsUrl:
      'https://developer.clickup.com/docs/connect-an-ai-assistant-to-clickups-mcp-server',
  },
  {
    id: 'airtable',
    name: 'Airtable',
    description: 'Read and write records in your bases.',
    category: 'productivity',
    setup: 'oauth',
    url: 'https://mcp.airtable.com/mcp',
    docsUrl: 'https://support.airtable.com/docs/using-the-airtable-mcp-server',
  },
  {
    id: 'intercom',
    name: 'Intercom',
    description: 'Look up conversations, contacts and help articles.',
    category: 'productivity',
    setup: 'oauth',
    url: 'https://mcp.intercom.com/mcp',
    docsUrl: 'https://developers.intercom.com/docs/guides/mcp',
  },

  // Payments & commerce
  {
    id: 'stripe',
    name: 'Stripe',
    description: 'Customers, payments, invoices and payment links.',
    category: 'payments',
    setup: 'oauth',
    url: 'https://mcp.stripe.com',
    docsUrl: 'https://docs.stripe.com/mcp',
  },
  {
    id: 'paypal',
    name: 'PayPal',
    description: 'Invoices, orders, subscriptions and disputes.',
    category: 'payments',
    setup: 'oauth',
    url: 'https://mcp.paypal.com/mcp',
    docsUrl: 'https://developer.paypal.com/tools/mcp-server/',
  },
  {
    id: 'square',
    name: 'Square',
    description: 'Payments, orders, catalog and customers.',
    category: 'payments',
    setup: 'oauth',
    url: 'https://mcp.squareup.com/mcp',
    docsUrl: 'https://developer.squareup.com/docs/mcp',
  },
  {
    id: 'mercadopago',
    name: 'Mercado Pago',
    description: 'Payments and integration tools for Latin America.',
    category: 'payments',
    setup: 'oauth',
    url: 'https://mcp.mercadopago.com/mcp',
    docsUrl:
      'https://www.mercadopago.com/developers/en/docs/mcp-server/overview',
  },

  // Marketing & content
  {
    id: 'canva',
    name: 'Canva',
    description: 'Search, create and export designs.',
    category: 'marketing',
    setup: 'oauth',
    url: 'https://mcp.canva.com/mcp',
    docsUrl: 'https://www.canva.dev/docs/mcp/',
  },
  {
    id: 'buffer',
    name: 'Buffer',
    description: 'Draft, schedule and review social media posts.',
    category: 'marketing',
    setup: 'oauth',
    url: 'https://mcp.buffer.com/mcp',
    docsUrl: 'https://buffer.com/developers',
  },
  {
    id: 'webflow',
    name: 'Webflow',
    description: 'Manage sites, pages and CMS collections.',
    category: 'marketing',
    setup: 'oauth',
    url: 'https://mcp.webflow.com/mcp',
    docsUrl: 'https://developers.webflow.com/mcp',
  },
  {
    id: 'wix',
    name: 'Wix',
    description: 'Manage your Wix sites, stores and bookings.',
    category: 'marketing',
    setup: 'oauth',
    url: 'https://mcp.wix.com/mcp',
    docsUrl:
      'https://dev.wix.com/docs/sdk/articles/use-the-wix-mcp/about-the-wix-mcp',
  },

  // Google Workspace — no dynamic registration; bring your own OAuth client.
  {
    id: 'gmail',
    name: 'Gmail',
    description: 'Read, search, draft and send email.',
    category: 'google',
    setup: 'oauth-own-app',
    url: 'https://gmailmcp.googleapis.com/mcp/v1',
    docsUrl:
      'https://developers.google.com/workspace/guides/configure-mcp-servers',
    scopes: ['https://www.googleapis.com/auth/gmail.modify'],
  },
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    description: 'Check availability and manage events.',
    category: 'google',
    setup: 'oauth-own-app',
    url: 'https://calendarmcp.googleapis.com/mcp/v1',
    docsUrl:
      'https://developers.google.com/workspace/guides/configure-mcp-servers',
    scopes: ['https://www.googleapis.com/auth/calendar'],
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    description: 'Search and read files; create new ones.',
    category: 'google',
    setup: 'oauth-own-app',
    url: 'https://drivemcp.googleapis.com/mcp/v1',
    docsUrl:
      'https://developers.google.com/workspace/guides/configure-mcp-servers',
    scopes: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/drive.file',
    ],
  },

  // Developer
  {
    id: 'sentry',
    name: 'Sentry',
    description: 'Investigate errors, issues and releases.',
    category: 'developer',
    setup: 'oauth',
    url: 'https://mcp.sentry.dev/mcp',
    docsUrl: 'https://docs.sentry.io/product/sentry-mcp/',
  },
  {
    id: 'digitalocean',
    name: 'DigitalOcean',
    description: 'Manage droplets, apps, databases and DNS.',
    category: 'developer',
    setup: 'oauth',
    url: 'https://mcp.digitalocean.com/mcp',
    docsUrl: 'https://docs.digitalocean.com/reference/mcp/configure-mcp/',
    apiKey: {
      label: 'API token',
      setupUrl: 'https://cloud.digitalocean.com/account/api/tokens',
      headerName: 'Authorization',
      valuePrefix: 'Bearer ',
    },
  },
  {
    id: 'vercel',
    name: 'Vercel',
    description: 'Inspect projects, deployments and logs.',
    category: 'developer',
    setup: 'oauth',
    url: 'https://mcp.vercel.com',
    docsUrl: 'https://vercel.com/docs/mcp/vercel-mcp',
  },
];

export function findCatalogEntry(id: string): McpCatalogDefinition | undefined {
  return MCP_CATALOG.find((entry) => entry.id === id);
}

/**
 * Server config for a catalog entry. `clientId`/`clientSecret` only apply to
 * `oauth-own-app` entries; `apiKey` (for entries offering that option)
 * replaces sign-in with a static header. Secrets are passed through as
 * inline values for the caller to encrypt.
 */
export function catalogServerConfig(
  entry: McpCatalogDefinition,
  client?: {
    clientId?: string | undefined;
    clientSecret?: string | undefined;
    apiKey?: string | undefined;
  },
): McpServerConfig {
  const apiKey = entry.apiKey ? client?.apiKey?.trim() : undefined;
  if (entry.apiKey && apiKey) {
    return {
      id: entry.id,
      name: entry.name,
      transport: 'http',
      url: entry.url,
      headers: {
        [entry.apiKey.headerName]: {
          kind: 'inline',
          value: `${entry.apiKey.valuePrefix}${apiKey}`,
        },
      },
    };
  }

  const clientId =
    entry.setup === 'oauth-own-app' ? client?.clientId?.trim() : undefined;
  const clientSecret =
    entry.setup === 'oauth-own-app' ? client?.clientSecret?.trim() : undefined;
  return {
    id: entry.id,
    name: entry.name,
    transport: 'http',
    url: entry.url,
    auth: {
      type: 'oauth',
      ...(clientId ? { clientId } : {}),
      ...(clientSecret
        ? { clientSecret: { kind: 'inline' as const, value: clientSecret } }
        : {}),
      ...(entry.scopes ? { scopes: entry.scopes } : {}),
    },
  };
}
