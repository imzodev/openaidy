/**
 * Single source of truth for the OpenAidy version.
 *
 * Resolution algorithm: walk up from this server file's directory looking for
 * the nearest `package.json` that has a `version` field. Return that version.
 *
 * Why walk-up?
 *  - In dev (`pnpm dev`): server file is `apps/server/src/server.ts`. The walk
 *    skips `apps/server/package.json` (no `version` field) and lands on the repo
 *    root `package.json` which has `version: "0.3.0"`.
 *  - In a packaged install (`npm i -g @openaidy/app`): server file is
 *    `<install>/dist/server.mjs`. The walk lands on `<install>/package.json`
 *    which has the package version.
 *
 * This is the ONLY code path that reads the version. No env vars, no compiled
 * constants, no CLI injection. Bump `package.json`, restart, get the new
 * version — no rebuild required.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FALLBACK_VERSION = '0.0.0';

export function resolveOpenAidyVersion(startDir?: string): string {
  const here = startDir ?? dirname(fileURLToPath(import.meta.url));
  for (let dir = here; dirname(dir) !== dir; dir = dirname(dir)) {
    const candidate = resolve(dir, 'package.json');
    if (!existsSync(candidate)) continue;
    try {
      const pkg = JSON.parse(readFileSync(candidate, 'utf-8')) as {
        version?: unknown;
      };
      if (typeof pkg.version === 'string' && pkg.version) {
        return pkg.version;
      }
    } catch {
      // malformed package.json — keep walking
    }
  }
  return FALLBACK_VERSION;
}

/**
 * OpenAidy version, resolved once at module load.
 *
 * Returned value is semver (`"0.3.0"`, no `v` prefix). The UI prepends `v` for
 * display to match the GitHub release tag format.
 */
export const OPEN_AIDY_VERSION = resolveOpenAidyVersion();
