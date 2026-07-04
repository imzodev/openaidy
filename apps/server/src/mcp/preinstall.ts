/**
 * Preinstalled MCP server seeding.
 *
 * The config template (`config/openaidy.template.json`) ships a set of
 * preinstalled MCP servers. The template is only copied into a user's config
 * on first run, so servers added to the template later never reached existing
 * installs. This reconciles the template's servers into an existing config on
 * startup — mirroring the skills seed manifest — so a newly shipped default
 * server lands automatically on update, without clobbering the user's own
 * servers or resurrecting ones they deleted.
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import type { McpServerConfig } from '@openaidy/config';

/** Per-server manifest entry — the hash of the template definition we seeded. */
export type McpSeedManifestEntry = { hash: string };

/** Maps a seeded server id → the template definition hash last observed. */
export type McpSeedManifest = Record<string, McpSeedManifestEntry>;

export const MCP_SEED_MANIFEST_FILE = '.mcp-seed-manifest.json';

/** Stable content hash of a template server definition. */
export function hashMcpServer(server: McpServerConfig): string {
  return createHash('sha256').update(JSON.stringify(server)).digest('hex');
}

export type ReconcileResult = {
  /** The (possibly extended) server list to persist. */
  servers: McpServerConfig[];
  /** The manifest to persist. */
  manifest: McpSeedManifest;
  /** Ids of servers newly added to the config this run. */
  added: string[];
  /** Whether the manifest changed (config or manifest needs persisting). */
  changed: boolean;
};

/**
 * Decide which preinstalled (template) MCP servers to add to a config. Pure —
 * no IO.
 *
 * Policy (mirrors the skills seed manifest in {@link ./../skills/seed}):
 * - Template server already in the config → left untouched (a user's own edits
 *   are never clobbered); the manifest is refreshed so a later deletion is
 *   remembered.
 * - Template server absent from the config but present in the manifest → the
 *   user deleted it after it was seeded, so it is NOT re-added.
 * - Template server absent from both → a newly shipped preinstalled server;
 *   add it and record it in the manifest.
 */
export function reconcilePreinstalledMcpServers(
  currentServers: McpServerConfig[],
  templateServers: McpServerConfig[],
  manifest: McpSeedManifest,
): ReconcileResult {
  const nextManifest: McpSeedManifest = { ...manifest };
  const presentIds = new Set(currentServers.map((s) => s.id));
  const servers = [...currentServers];
  const added: string[] = [];

  for (const tpl of templateServers) {
    const hash = hashMcpServer(tpl);

    if (presentIds.has(tpl.id)) {
      // Already configured — respect the user's copy, just record that we've
      // seen this server so a future deletion isn't undone.
      nextManifest[tpl.id] = { hash };
      continue;
    }

    if (manifest[tpl.id]) {
      // Seeded before and since removed by the user — do not resurrect it.
      continue;
    }

    // Brand-new preinstalled server — add it.
    servers.push(tpl);
    nextManifest[tpl.id] = { hash };
    added.push(tpl.id);
  }

  return {
    servers,
    manifest: nextManifest,
    added,
    changed: added.length > 0 || !manifestsEqual(manifest, nextManifest),
  };
}

function manifestsEqual(a: McpSeedManifest, b: McpSeedManifest): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => a[k]?.hash === b[k]?.hash);
}

/** Read the manifest, returning an empty one if absent or unreadable. */
export function readMcpSeedManifest(manifestPath: string): McpSeedManifest {
  if (!existsSync(manifestPath)) return {};
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf-8')) as McpSeedManifest;
  } catch {
    return {};
  }
}

/** Persist the manifest atomically. */
export function writeMcpSeedManifest(
  manifestPath: string,
  manifest: McpSeedManifest,
): void {
  mkdirSync(dirname(manifestPath), { recursive: true });
  const tempPath = `${manifestPath}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
  renameSync(tempPath, manifestPath);
}
