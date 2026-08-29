import { describe, it, expect } from 'vitest';
import type { McpServerConfig } from '@openaidy/config';
import {
  reconcilePreinstalledMcpServers,
  hashMcpServer,
  type McpSeedManifest,
} from './preinstall';

const github: McpServerConfig = {
  id: 'github',
  name: 'GitHub Tools',
  transport: 'http',
  url: 'https://api.githubcopilot.com/mcp/',
  headers: { Authorization: 'Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}' },
};

const fetchServer: McpServerConfig = {
  id: 'fetch',
  name: 'Fetch',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-fetch'],
  env: {},
};

const sequentialThinking: McpServerConfig = {
  id: 'sequential-thinking',
  name: 'Sequential Thinking',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
};

const time: McpServerConfig = {
  id: 'time',
  name: 'Time',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@guanxiong/mcp-server-time'],
};

const playwright: McpServerConfig = {
  id: 'playwright',
  name: 'Playwright Browser',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@playwright/mcp@latest'],
};

const context7: McpServerConfig = {
  id: 'context7',
  name: 'Context7 Docs',
  transport: 'http',
  url: 'https://mcp.context7.com/mcp',
};

const braveSearch: McpServerConfig = {
  id: 'brave-search',
  name: 'Brave Search',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@brave/brave-search-mcp-server'],
  env: { BRAVE_API_KEY: '${BRAVE_API_KEY}' },
};

const tavily: McpServerConfig = {
  id: 'tavily',
  name: 'Tavily Search',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', 'tavily-mcp@latest'],
  env: { TAVILY_API_KEY: '${TAVILY_API_KEY}' },
};

const buffer: McpServerConfig = {
  id: 'buffer',
  name: 'Buffer',
  transport: 'http',
  url: 'https://mcp.buffer.com/mcp',
  headers: { Authorization: 'Bearer ${BUFFER_API_KEY}' },
};

const supabase: McpServerConfig = {
  id: 'supabase',
  name: 'Supabase',
  transport: 'http',
  url: 'https://mcp.supabase.com/mcp?features=docs%2Caccount%2Cdatabase%2Cdebugging%2Cdevelopment%2Cfunctions%2Cbranching',
  headers: { Authorization: 'Bearer ${SUPABASE_ACCESS_TOKEN}' },
};

const notion: McpServerConfig = {
  id: 'notion',
  name: 'Notion',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@notionhq/notion-mcp-server'],
  env: {
    OPENAPI_MCP_HEADERS:
      '{"Authorization": "Bearer ${NOTION_TOKEN}", "Notion-Version": "2025-09-03"}',
  },
};

/** The full preinstalled set shipped in `config/openaidy.template.json`. */
const allPreinstalled: McpServerConfig[] = [
  github,
  sequentialThinking,
  time,
  playwright,
  context7,
  braveSearch,
  tavily,
  buffer,
  supabase,
  notion,
];

describe('reconcilePreinstalledMcpServers', () => {
  it('adds a new template server absent from config and manifest', () => {
    const result = reconcilePreinstalledMcpServers([], [github], {});

    expect(result.added).toEqual(['github']);
    expect(result.servers).toEqual([github]);
    expect(result.manifest['github']?.hash).toBe(hashMcpServer(github));
    expect(result.changed).toBe(true);
  });

  it('does NOT re-add a server the user deleted (absent from config, present in manifest)', () => {
    const manifest: McpSeedManifest = {
      github: { hash: hashMcpServer(github) },
    };

    const result = reconcilePreinstalledMcpServers([], [github], manifest);

    expect(result.added).toEqual([]);
    expect(result.servers).toEqual([]);
    expect(result.changed).toBe(false);
  });

  it('leaves an untracked, user-differing server untouched and does not adopt it', () => {
    // User has their own copy of github (different from the template) that we
    // never seeded — we must neither overwrite nor claim it in the manifest.
    const userGithub: McpServerConfig = { ...github, name: 'My GitHub' };

    const result = reconcilePreinstalledMcpServers([userGithub], [github], {});

    expect(result.added).toEqual([]);
    expect(result.updated).toEqual([]);
    expect(result.servers).toEqual([userGithub]); // unchanged, not overwritten
    expect(result.manifest['github']).toBeUndefined(); // not adopted
    expect(result.changed).toBe(false);
  });

  it('adds only the new server when one is already configured', () => {
    const result = reconcilePreinstalledMcpServers(
      [github],
      [github, fetchServer],
      { github: { hash: hashMcpServer(github) } },
    );

    expect(result.added).toEqual(['fetch']);
    expect(result.servers.map((s) => s.id)).toEqual(['github', 'fetch']);
  });

  it('is idempotent — a second run adds nothing and reports no change', () => {
    const first = reconcilePreinstalledMcpServers([], [github], {});
    const second = reconcilePreinstalledMcpServers(
      first.servers,
      [github],
      first.manifest,
    );

    expect(second.added).toEqual([]);
    expect(second.changed).toBe(false);
    expect(second.servers).toEqual(first.servers);
  });

  it('no template servers → no change', () => {
    const result = reconcilePreinstalledMcpServers([github], [], {});

    expect(result.added).toEqual([]);
    expect(result.updated).toEqual([]);
    expect(result.changed).toBe(false);
    expect(result.servers).toEqual([github]);
  });

  it('updates a pristine (as-seeded) server when the template definition changed', () => {
    // Previously seeded the old stdio github; manifest records that hash.
    const oldGithub: McpServerConfig = {
      id: 'github',
      name: 'GitHub Tools',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: '${GITHUB_PERSONAL_ACCESS_TOKEN}' },
    };
    const manifest: McpSeedManifest = {
      github: { hash: hashMcpServer(oldGithub) },
    };

    // Template now ships the http remote definition (`github`).
    const result = reconcilePreinstalledMcpServers(
      [oldGithub],
      [github],
      manifest,
    );

    expect(result.updated).toEqual(['github']);
    expect(result.added).toEqual([]);
    expect(result.servers).toEqual([github]); // replaced with new definition
    expect(result.manifest['github']?.hash).toBe(hashMcpServer(github));
    expect(result.changed).toBe(true);
  });

  it('does NOT update a server the user modified since it was seeded', () => {
    const oldGithub: McpServerConfig = {
      id: 'github',
      name: 'GitHub Tools',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: '${GITHUB_PERSONAL_ACCESS_TOKEN}' },
    };
    // Manifest hash reflects the ORIGINAL seed; the user has since edited it.
    const manifest: McpSeedManifest = {
      github: { hash: hashMcpServer(oldGithub) },
    };
    const userEdited: McpServerConfig = { ...oldGithub, name: 'My GitHub' };

    const result = reconcilePreinstalledMcpServers(
      [userEdited],
      [github],
      manifest,
    );

    expect(result.updated).toEqual([]);
    expect(result.servers).toEqual([userEdited]); // preserved, not clobbered
  });

  it('adopts an untracked server that is byte-identical to the template', () => {
    // Server present and equal to the template, but never recorded (no entry).
    const result = reconcilePreinstalledMcpServers([github], [github], {});

    expect(result.added).toEqual([]);
    expect(result.updated).toEqual([]);
    expect(result.servers).toEqual([github]); // unchanged
    expect(result.manifest['github']?.hash).toBe(hashMcpServer(github)); // adopted
    expect(result.changed).toBe(true); // manifest gained the entry
  });

  it('seeds every preinstalled server into a fresh install with no manifest', () => {
    // Fresh install: empty config, empty manifest, full template set.
    const result = reconcilePreinstalledMcpServers([], allPreinstalled, {});

    expect(result.added).toEqual(allPreinstalled.map((s) => s.id));
    expect(result.updated).toEqual([]);
    expect(result.servers).toEqual(allPreinstalled);
    // Every preinstalled id is tracked in the manifest after seeding.
    for (const server of allPreinstalled) {
      expect(result.manifest[server.id]?.hash).toBe(hashMcpServer(server));
    }
    expect(result.changed).toBe(true);
  });

  it('is idempotent across the full preinstalled set on a second run', () => {
    // After a successful first run, a second boot must be a no-op.
    const first = reconcilePreinstalledMcpServers([], allPreinstalled, {});
    const second = reconcilePreinstalledMcpServers(
      first.servers,
      allPreinstalled,
      first.manifest,
    );

    expect(second.added).toEqual([]);
    expect(second.updated).toEqual([]);
    expect(second.changed).toBe(false);
    expect(second.servers).toEqual(allPreinstalled);
  });
});
