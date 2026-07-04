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
  /** The (possibly changed) server list to persist. */
  servers: McpServerConfig[];
  /** The manifest to persist. */
  manifest: McpSeedManifest;
  /** Ids of servers newly added to the config this run. */
  added: string[];
  /** Ids of preinstalled servers updated to a new template definition. */
  updated: string[];
  /** Whether the config or manifest changed (needs persisting). */
  changed: boolean;
};

/**
 * Reconcile the config's MCP servers against the template's preinstalled
 * servers. Pure — no IO.
 *
 * The manifest records, per server id, the hash of the definition we last
 * seeded/updated — so `manifest[id].hash === hash(configServer)` means the
 * user hasn't touched it since we wrote it. Policy (mirrors the skills seed
 * manifest in {@link ./../skills/seed}):
 *
 * - Absent from config, absent from manifest → newly shipped server; ADD it.
 * - Absent from config, present in manifest → user deleted a seeded server;
 *   do NOT re-add.
 * - Present and pristine (matches what we last seeded) → UPDATE to the new
 *   template definition when it changed; otherwise leave it.
 * - Present, untracked, but byte-identical to the template → ADOPT it (record
 *   in the manifest) so future template changes reach it too.
 * - Present and user-modified (or a user's own server with the same id) →
 *   leave it untouched, never clobbering their edits.
 */
export function reconcilePreinstalledMcpServers(
  currentServers: McpServerConfig[],
  templateServers: McpServerConfig[],
  manifest: McpSeedManifest,
): ReconcileResult {
  const nextManifest: McpSeedManifest = { ...manifest };
  const servers = [...currentServers];
  const indexById = new Map(currentServers.map((s, i) => [s.id, i]));
  const added: string[] = [];
  const updated: string[] = [];

  for (const tpl of templateServers) {
    const templateHash = hashMcpServer(tpl);
    const idx = indexById.get(tpl.id);

    if (idx === undefined) {
      if (manifest[tpl.id]) continue; // deleted by user — don't resurrect
      servers.push(tpl);
      nextManifest[tpl.id] = { hash: templateHash };
      added.push(tpl.id);
      continue;
    }

    const currentHash = hashMcpServer(servers[idx]!);
    const seededHash = manifest[tpl.id]?.hash;

    if (seededHash === currentHash) {
      // Pristine as-seeded — safe to update to a changed template definition.
      if (templateHash !== currentHash) {
        servers[idx] = tpl;
        nextManifest[tpl.id] = { hash: templateHash };
        updated.push(tpl.id);
      }
    } else if (seededHash === undefined && currentHash === templateHash) {
      // Untracked but identical to the template — adopt it so future template
      // changes can update it. Config is unchanged.
      nextManifest[tpl.id] = { hash: templateHash };
    }
    // Otherwise the user created or modified this server — leave it untouched.
  }

  return {
    servers,
    manifest: nextManifest,
    added,
    updated,
    changed:
      added.length > 0 ||
      updated.length > 0 ||
      !manifestsEqual(manifest, nextManifest),
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
