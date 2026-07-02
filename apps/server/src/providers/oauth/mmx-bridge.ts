import { spawn } from 'node:child_process';
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import {
  spawnCliOAuth,
  defaultIsInstalled,
  readJsonConfig,
  type CliOAuthDescriptor,
  type CliOAuthHandle,
  type CliOAuthResult,
  type CliOAuthTokens,
  type SpawnCliOAuthOptions,
} from './cli-bridge.js';

/**
 * Bridge to the official MiniMax CLI (`mmx-cli`).
 *
 * MiniMax's official CLI is the only first-party tool that can perform
 * the device-code OAuth flow against MiniMax's auth server. The endpoints
 * are NOT publicly documented — they require a special `client_id` that
 * mmx-cli ships with.
 *
 * As of this refactor, this file is a thin MiniMax-specific adapter on
 * top of the generic `cli-bridge.ts`. It contributes:
 *   - the `mmx-cli` binary name and argv shape
 *   - the path to `~/.mmx/config.json`
 *   - the format of the tokens mmx stores there
 *   - the MiniMax-specific verification URL builder
 *   - the `scrubConfig` step that strips a stale `api_key` from the
 *     mmx config (so mmx enters the browser flow instead of forcing
 *     non-interactive mode)
 *
 * The general spawn-PTY / parse-user-code / poll-config logic lives in
 * `cli-bridge.ts` and is shared with any future provider that needs
 * the same pattern.
 */

const MMX_CONFIG_DIR = process.env['MMX_CONFIG_DIR']
  ? process.env['MMX_CONFIG_DIR']
  : join(homedir(), '.mmx');
const MMX_CONFIG_PATH = join(MMX_CONFIG_DIR, 'config.json');

/** Tokens stored by mmx-cli in `~/.mmx/config.json` under the `oauth` key. */
export type MiniMaxOAuthTokens = {
  access_token: string;
  refresh_token: string;
  expires_at: string; // ISO 8601
  region?: 'global' | 'cn';
  resource_url?: string;
  account?: { id?: string; email?: string; name?: string };
};

/** What the bridge reads from `~/.mmx/config.json`. */
type MmxConfigFile = {
  oauth?: MiniMaxOAuthTokens;
  api_key?: string;
  region?: 'global' | 'cn';
  [key: string]: unknown;
};

/** Result of a successful OAuth login. */
export type MiniMaxLoginSuccess = {
  ok: true;
  tokens: MiniMaxOAuthTokens;
};

/** Result of a failed login (user cancelled, timeout, mmx error, etc). */
export type MiniMaxLoginFailure = {
  ok: false;
  error:
    | 'mmx_not_installed'
    | 'mmx_failed'
    | 'cancelled'
    | 'no_credentials'
    | 'unknown';
  message: string;
};

export type MiniMaxLoginResult = MiniMaxLoginSuccess | MiniMaxLoginFailure;

/** Options for `spawnMmxLogin`. */
export type MmxLoginOptions = {
  region: 'global' | 'cn';
  /** When the user gives up and clicks Cancel. */
  signal?: AbortSignal;
  /** Where mmx stores its config. Defaults to `~/.mmx/config.json`. */
  configPath?: string;
  /** How long to wait for the user to complete auth. Default 10 min. */
  timeoutMs?: number;
  /** Polling interval for `~/.mmx/config.json`. Default 2s. */
  pollIntervalMs?: number;
};

/**
 * Alias kept for backwards compatibility — `minimax.ts` (and any external
 * callers) historically imported this name. Prefer `MmxLoginOptions`.
 */
export type SpawnMmxLoginOptions = MmxLoginOptions;

/** Spawned process handle returned by `spawnMmxLogin`. */
export type MmxLoginHandle = CliOAuthHandle;

/**
 * How to invoke mmx: either the bundled copy shipped as an
 * `apps/server` dependency (preferred — no separate install step) or
 * a global `mmx` binary on PATH (fallback for anyone who already has
 * one installed).
 */
type MmxInvocation = { binary: string; prefixArgs: string[] };

/**
 * OpenAidy is plug-and-play: `mmx-cli` is declared as a normal
 * dependency of `apps/server` (see package.json) so `pnpm install`
 * pulls it in automatically. Resolve its bundled entry script here
 * instead of requiring a global `pnpm add -g mmx-cli` — the OAuth
 * flow should work immediately after install, with no extra manual
 * step. Falls back to a bare `mmx` on PATH if the bundled copy can't
 * be resolved for some reason.
 */
function resolveMmxInvocation(): MmxInvocation {
  try {
    const require = createRequire(import.meta.url);
    const pkgJsonPath = require.resolve('mmx-cli/package.json');
    const scriptPath = join(dirname(pkgJsonPath), 'dist', 'mmx.mjs');
    if (existsSync(scriptPath)) {
      return { binary: process.execPath, prefixArgs: [scriptPath] };
    }
  } catch {
    // mmx-cli isn't resolvable from here — fall back to PATH lookup.
  }
  return { binary: 'mmx', prefixArgs: [] };
}

const mmxInvocation = resolveMmxInvocation();

/**
 * The MiniMax-specific descriptor fed to the generic CLI bridge.
 * Kept private — callers go through `spawnMmxLogin` (which adds the
 * region flag and the MMX_CONFIG_DIR env var).
 */
const mmxDescriptor: CliOAuthDescriptor = {
  providerId: 'minimax',
  binary: mmxInvocation.binary,
  args: ({ extraArgs }) => [
    ...mmxInvocation.prefixArgs,
    'auth',
    'login',
    '--recommend',
    ...(extraArgs ?? []),
  ],
  buildVerificationUrl: (userCode) =>
    `https://platform.minimax.io/oauth-authorize?user_code=${userCode}&client=OpenAidy`,
  envVarsToStrip: [
    'MINIMAX_API_KEY',
    'MMX_API_KEY',
    'MMX_OAUTH_TOKEN',
    'MINIMAX_OAUTH_TOKEN',
  ],
  getConfigPath: () => MMX_CONFIG_PATH,
  readTokens: (configPath) => readMmxTokens(configPath),
  scrubConfig: (configPath) => scrubMmxConfig(configPath),
  isInstalled: () => isMmxInstalled(),
};

/**
 * Check whether mmx is available: either the bundled copy resolved at
 * module load, or a global `mmx` on PATH.
 */
export async function isMmxInstalled(): Promise<boolean> {
  if (mmxInvocation.binary !== 'mmx') return true;
  return defaultIsInstalled('mmx');
}

/**
 * Spawn `mmx auth login --recommend --region=<region>` and resolve when
 * the user completes auth. The user_code is parsed from mmx's stderr
 * and exposed via `handle.userCode` and `handle.verificationUrl`.
 *
 * Public API is unchanged from the pre-refactor version: same
 * `MmxLoginHandle` shape, same `MiniMaxLoginResult` shape, same
 * options. Internally it delegates to the generic `spawnCliOAuth`.
 */
export function spawnMmxLogin(options: MmxLoginOptions): MmxLoginHandle {
  // mmx reads MMX_CONFIG_DIR from env to find its config file.
  // We also set a diagnostic flag so we can verify the parent env
  // didn't have a MiniMax API key.
  const extraEnv: Record<string, string> = {
    MMX_CONFIG_DIR: MMX_CONFIG_DIR,
    OPENAIDY_HAD_MINIMAX_API_KEY: process.env['MINIMAX_API_KEY'] ? 'yes' : 'no',
  };

  // Map the public MmxLoginOptions to the generic SpawnCliOAuthOptions.
  // The region is injected as a CLI flag via `extraArgs`.
  const spawnOpts: SpawnCliOAuthOptions = {
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    extraEnv,
    extraArgs: [`--region=${options.region}`],
  };
  void options.pollIntervalMs; // accepted for API compatibility; the
  // generic bridge doesn't poll — it reads the config once on exit,
  // which is enough because mmx writes the file before exiting.

  return spawnCliOAuth(mmxDescriptor, spawnOpts);
}

/**
 * Read tokens from mmx-cli's config file. Returns null if no oauth
 * entry is present or the file doesn't exist.
 */
export function readMmxTokens(
  configPath: string = MMX_CONFIG_PATH,
): MiniMaxOAuthTokens | null {
  const parsed = readJsonConfig(configPath) as MmxConfigFile | null;
  if (!parsed) return null;
  if (parsed.oauth?.access_token && parsed.oauth?.refresh_token) {
    return parsed.oauth;
  }
  return null;
}

/**
 * Strip a stale `api_key` from `~/.mmx/config.json` so mmx enters
 * the interactive (browser) flow. mmx reads the config at startup
 * and re-injects any `api_key` it finds there into its env — which
 * would force non-interactive mode. We delete the key from the
 * config so mmx uses the browser flow.
 */
function scrubMmxConfig(configPath: string): void {
  if (!existsSync(configPath)) return;
  const parsed = readJsonConfig(configPath) as MmxConfigFile | null;
  if (!parsed || !parsed.api_key) return;
  delete parsed.api_key;
  writeFile(configPath, JSON.stringify(parsed, null, 2), 'utf-8');
  chmod(configPath, 0o600).catch(() => undefined);
}

/**
 * Delete the oauth entry from mmx-cli's config (used on disconnect).
 */
export async function clearMmxTokens(
  configPath: string = MMX_CONFIG_PATH,
): Promise<void> {
  if (!existsSync(configPath)) return;
  const raw = await readFile(configPath, 'utf-8');
  const parsed = JSON.parse(raw) as MmxConfigFile;
  if ('oauth' in parsed) {
    delete parsed.oauth;
    await writeFile(configPath, JSON.stringify(parsed, null, 2), 'utf-8');
    await chmod(configPath, 0o600).catch(() => undefined);
  }
}

/**
 * Where mmx-cli stores its config. Exposed for tests and the
 * /status endpoint.
 */
export function getMmxConfigPath(): string {
  return MMX_CONFIG_PATH;
}

/** Current OS user (used for error messages). */
export function getCurrentOsUser(): string {
  try {
    return userInfo().username;
  } catch {
    return 'unknown';
  }
}

// ── Re-exports for convenience ───────────────────────────────────────────

export type {
  CliOAuthHandle,
  CliOAuthResult,
  CliOAuthTokens,
  SpawnCliOAuthOptions,
};

// Re-export `spawn` so existing test imports keep working (some
// tests may import `spawn` indirectly via the bridge module shape).
export { spawn };
