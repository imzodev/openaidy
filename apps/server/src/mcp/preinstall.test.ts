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

  it('leaves an existing server untouched but records it in the manifest', () => {
    // User has their own edited copy of github (extra arg); must not be clobbered.
    const userGithub: McpServerConfig = {
      ...github,
      args: [...(github.args ?? []), '--verbose'],
    };

    const result = reconcilePreinstalledMcpServers([userGithub], [github], {});

    expect(result.added).toEqual([]);
    expect(result.servers).toEqual([userGithub]); // unchanged, not overwritten
    // Manifest records the TEMPLATE hash so a later deletion is remembered.
    expect(result.manifest['github']?.hash).toBe(hashMcpServer(github));
    expect(result.changed).toBe(true); // manifest gained an entry
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
    expect(result.changed).toBe(false);
    expect(result.servers).toEqual([github]);
  });
});
