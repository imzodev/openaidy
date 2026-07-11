import type { FastifyPluginAsync } from 'fastify';
import { OPEN_AIDY_VERSION } from '../lib/version';

/**
 * Build / runtime info exposed to the web client.
 *
 * Returned values:
 *  - version: semver only ("0.3.0", no "v" prefix). The UI prepends "v" for
 *    display to match the GitHub release tag format.
 *  - nodeVersion, platform, arch: standard runtime introspection.
 *  - pid: the server's PID, useful for support requests.
 *  - startedAt: ISO timestamp of when the server booted.
 *  - uptimeMs: milliseconds since boot.
 */
export interface AppInfo {
  version: string;
  nodeVersion: string;
  platform: string;
  arch: string;
  pid: number;
  startedAt: string;
  uptimeMs: number;
}

export const infoRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/info',
    async (): Promise<AppInfo> => ({
      version: OPEN_AIDY_VERSION,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      startedAt: new Date().toISOString(),
      uptimeMs: Math.round(process.uptime() * 1000),
    }),
  );
};
