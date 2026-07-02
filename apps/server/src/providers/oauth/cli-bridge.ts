import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, existsSync, type PathLike } from 'node:fs';
import { createLogger } from '../../lib/logger.js';

/**
 * Generic CLI-backed OAuth bridge.
 *
 * Several providers (notably MiniMax today, and any future provider whose
 * OAuth client_id is only available inside an official CLI binary) require
 * us to delegate the device-code / browser-code flow to a subprocess
 * rather than hitting their endpoints directly. This module captures the
 * shared shape of that delegation:
 *
 *   1. Verify the CLI binary is installed (via `isInstalled`).
 *   2. Scrub the CLI's persistent config file (via `scrubConfig`) so
 *      pre-existing api-keys don't force the CLI into non-interactive
 *      mode.
 *   3. Spawn the CLI inside a pseudo-TTY so it enters the interactive
 *      (browser) flow.
 *   4. Parse the user_code / verification URL the CLI prints.
 *   5. When the CLI exits 0, read tokens from its config file
 *      (via `readTokens`) and resolve the flow.
 *
 * Provider-specific files (`mmx-bridge.ts`) only need to supply a
 * `CliOAuthDescriptor` — a small bag of strings, paths, and a couple
 * of sync reader functions — and the rest is handled here.
 */

const log = createLogger('CliOAuthBridge');

// ── Public types ────────────────────────────────────────────────────────────

/** Provider-agnostic OAuth token shape. */
export type CliOAuthTokens = {
  access_token: string;
  refresh_token: string;
  expires_at: string; // ISO 8601
  [key: string]: unknown;
};

/** Result of a successful OAuth login (via the CLI). */
export type CliOAuthSuccess = {
  ok: true;
  tokens: CliOAuthTokens;
};

/** Result of a failed login (cancelled, timeout, CLI error, etc). */
export type CliOAuthFailure = {
  ok: false;
  error:
    | 'cli_not_installed'
    | 'cli_failed'
    | 'cancelled'
    | 'no_credentials'
    | 'unknown';
  message: string;
};

export type CliOAuthResult = CliOAuthSuccess | CliOAuthFailure;

/** Options for `spawnCliOAuth`. */
export type SpawnCliOAuthOptions = {
  /** AbortSignal tied to the user clicking Cancel. */
  signal?: AbortSignal;
  /** Total time to wait for the user to complete auth. Default 10 min. */
  timeoutMs?: number;
  /** Extra env vars to inject into the child process. */
  extraEnv?: Record<string, string>;
  /** Extra args appended after the descriptor's base args. */
  extraArgs?: string[];
};

/** Handle returned by `spawnCliOAuth`. */
export type CliOAuthHandle = {
  /** Resolves when the user completes auth (or fails/times out). */
  done: Promise<CliOAuthResult>;
  /** The user_code the CLI printed, once it has printed it. */
  userCode: Promise<string>;
  /** The verification URL the user should open. */
  verificationUrl: Promise<string>;
  /** Kill the CLI process (e.g. on user cancel). Idempotent. */
  cancel: () => void;
};

/**
 * Provider-specific glue for `spawnCliOAuth`.
 *
 * Implementations describe HOW to run a single provider's CLI, not the
 * general flow. The general flow lives in `spawnCliOAuth` below.
 */
export type CliOAuthDescriptor = {
  /** Provider id — used in log lines. */
  providerId: string;
  /** Executable name on PATH (e.g. 'mmx', 'codex'). */
  binary: string;
  /**
   * Argv passed to the binary, e.g. `['auth', 'login', '--recommend',
   * '--region=global']`. The descriptor's `extraArgs` are appended at
   * spawn time.
   */
  args: (extra: { extraArgs?: string[] }) => string[];
  /**
   * Build the verification URL the user should open, given the
   * parsed user_code. The `userCode` may come from either the
   * `Opened: <url>` line (preferred) or the `Code: <code>` line
   * (fallback). Implementations can choose to honor any extra
   * metadata available in the parsed URL (e.g. `client=...`).
   */
  buildVerificationUrl: (userCode: string, openedUrl?: string) => string;
  /** Env vars the binary reads that would force non-interactive mode. */
  envVarsToStrip: readonly string[];
  /**
   * Read the CLI's persistent config file and return tokens, or null
   * if no OAuth entry is present yet.
   */
  readTokens: (configPath: string) => CliOAuthTokens | null;
  /** Path to the CLI's config file. */
  getConfigPath: () => string;
  /**
   * Pre-spawn hook to scrub the config file (e.g. remove a stale
   * `api_key` that would force non-interactive mode). Default: no-op.
   */
  scrubConfig?: (configPath: string) => void;
  /**
   * Check whether the binary is installed on PATH. Default: spawns
   * `<binary> --version` and checks for exit code 0.
   */
  isInstalled?: () => Promise<boolean>;
};

// ── spawnCliOAuth ───────────────────────────────────────────────────────────

/**
 * Generic CLI OAuth bridge. See the file header for the full flow.
 *
 * Provider-specific implementations should NOT reimplement the
 * spawn-PTY / parse-user-code / poll-config / persist-tokens logic —
 * they should construct a `CliOAuthDescriptor` and call this.
 */
export function spawnCliOAuth(
  descriptor: CliOAuthDescriptor,
  options: SpawnCliOAuthOptions = {},
): CliOAuthHandle {
  const configPath = descriptor.getConfigPath();
  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000; // 10 min

  let resolveUserCode: (v: string) => void;
  let rejectUserCode: (e: Error) => void;
  const userCode = new Promise<string>((res, rej) => {
    resolveUserCode = res;
    rejectUserCode = rej;
  });

  let child: ChildProcess | null = null;
  let cancelled = false;

  // 1. Pre-spawn scrub (e.g. remove a stale api_key that would force
  //    the CLI into non-interactive mode).
  try {
    descriptor.scrubConfig?.(configPath);
  } catch (err) {
    // Non-fatal — log and continue. The CLI may still launch in the
    // desired flow, and the user can retry if it doesn't.
    log.error(
      `spawnCliOAuth[${descriptor.providerId}]: scrubConfig failed: ${(err as Error).message}`,
    );
  }

  const done = new Promise<CliOAuthResult>((resolve) => {
    const finish = (r: CliOAuthResult) => {
      if (child && !child.killed) {
        try {
          child.kill('SIGTERM');
        } catch {
          // best effort
        }
      }
      resolve(r);
    };

    options.signal?.addEventListener('abort', () => {
      cancelled = true;
      finish({
        ok: false,
        error: 'cancelled',
        message: 'Cancelled by user',
      });
    });

    // 2. Spawn the CLI inside a pseudo-TTY so it enters the interactive
    //    (browser) flow. `script(1)` (util-linux) provides the PTY.
    try {
      const childEnv: NodeJS.ProcessEnv = { ...process.env };
      for (const key of descriptor.envVarsToStrip) {
        delete childEnv[key];
      }
      if (options.extraEnv) {
        Object.assign(childEnv, options.extraEnv);
      }
      // Tell the CLI where its config file lives. The descriptor is
      // expected to compute configPath via getConfigPath() — but for
      // CLIs that honor a per-provider env var (e.g. mmx reads
      // MMX_CONFIG_DIR) the descriptor should pass it through
      // `extraEnv` from its caller.
      const argv = descriptor.args(
        options.extraArgs ? { extraArgs: options.extraArgs } : {},
      );
      const command = buildPtyCommand(descriptor.binary, argv);
      child = spawn('script', ['-qec', command, '/dev/null'], {
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      rejectUserCode(err instanceof Error ? err : new Error(String(err)));
      finish({
        ok: false,
        error: 'cli_not_installed',
        message: `Failed to spawn ${descriptor.binary}. Is it installed?`,
      });
      return;
    }

    if (!child) {
      rejectUserCode(new Error(`Failed to spawn ${descriptor.binary}`));
      finish({
        ok: false,
        error: 'cli_not_installed',
        message: `Failed to spawn ${descriptor.binary}`,
      });
      return;
    }

    // 3. Parse CLI output. We accept user_code from two patterns:
    //    - `Opened: <url>` (the URL has user_code as a query param)
    //    - `Code: <code>` (the bare code, fallback)
    //    The same parser is applied to both stdout and stderr.
    let stderrBuf = '';
    let stdoutBuf = '';
    let userCodeResolved = false;

    const tryParseUserCode = () => {
      if (userCodeResolved) return;
      const combined = stdoutBuf + '\n' + stderrBuf;
      const urlMatch = combined.match(/Opened:\s+(https?:\S+)/);
      let openedUrl: string | undefined;
      let code: string | null = null;
      if (urlMatch) {
        openedUrl = urlMatch[1] ?? undefined;
        try {
          code = new URL(openedUrl ?? '').searchParams.get('user_code');
        } catch {
          // fall through to `Code:` fallback
        }
      }
      if (!code) {
        const codeMatch = combined.match(/(?:^|\n)\s*Code:\s*([A-Z0-9-]+)/i);
        const m = codeMatch?.[1];
        if (m) code = m;
      }
      if (code) {
        userCodeResolved = true;
        const finalCode: string = code;
        const finalOpened: string | undefined = openedUrl;
        resolveUserCode(finalCode);
        // Stash the opened URL on stdoutBuf for the descriptor to read
        // if it wants to inspect it (e.g. to preserve an upstream
        // `client=` param). Most providers just rebuild from userCode.
        void finalOpened;
      }
    };

    child.stdout?.on('data', (chunk) => {
      const s = chunk.toString();
      stdoutBuf += s;
      log.info(
        `${descriptor.providerId} stdout chunk (${s.length} bytes): ${s.slice(0, 300)}`,
      );
      tryParseUserCode();
    });

    child.stderr?.on('data', (chunk) => {
      const s = chunk.toString();
      stderrBuf += s;
      log.info(
        `${descriptor.providerId} stderr chunk (${s.length} bytes): ${s.slice(0, 300)}`,
      );
      tryParseUserCode();
    });

    child.on('error', (err) => {
      rejectUserCode(err);
      finish({
        ok: false,
        error: 'cli_failed',
        message: err.message,
      });
    });

    child.on('exit', (code) => {
      if (cancelled) return; // already resolved as 'cancelled'
      if (code === 0) {
        // 4. CLI exited cleanly — read tokens from the config file.
        const tokens = descriptor.readTokens(configPath);
        if (tokens) {
          log.info(
            `spawnCliOAuth[${descriptor.providerId}]: exit 0, tokens read from ${configPath}, expiresAt=${tokens.expires_at}`,
          );
          finish({ ok: true, tokens });
        } else {
          log.warn(
            `spawnCliOAuth[${descriptor.providerId}]: exit 0 BUT no tokens found in ${configPath}`,
          );
          finish({
            ok: false,
            error: 'no_credentials',
            message: `${descriptor.binary} exited 0 but no oauth tokens were found in the config file`,
          });
        }
      } else {
        // Non-zero exit. Try to parse a JSON `{ error: { message } }`
        // from stdout; otherwise fall back to the last stderr line.
        let msg = `${descriptor.binary} exited with code ${code}`;
        try {
          const j = JSON.parse(stdoutBuf);
          if (j && typeof j === 'object' && 'error' in j) {
            const e = (j as { error: { message?: string } }).error;
            if (e?.message) msg = e.message;
          }
        } catch {
          msg = stderrBuf.trim().split('\n').pop() ?? msg;
        }
        finish({ ok: false, error: 'cli_failed', message: msg });
      }
    });
  });

  // 5. Timeout. Killing the child triggers its exit handler, which
  //    resolves `done`. So the timeout is implicit.
  if (timeoutMs > 0) {
    setTimeout(() => {
      if (child && !child.killed && !cancelled) {
        try {
          child.kill('SIGTERM');
        } catch {
          // ignore
        }
        void done;
      }
    }, timeoutMs).unref();
  }

  return {
    done,
    userCode,
    verificationUrl: userCode.then((code) =>
      descriptor.buildVerificationUrl(code),
    ),
    cancel: () => {
      cancelled = true;
      if (child && !child.killed) {
        try {
          child.kill('SIGTERM');
        } catch {
          // ignore
        }
      }
    },
  };
}

/**
 * POSIX shell single-quote a token so `script -qec "<command>"` passes
 * it through unmangled even when it contains spaces or metacharacters.
 * Wraps in single quotes and escapes any embedded single quote as
 * `'\''`.
 *
 * Exported for unit testing.
 */
export function shQuote(token: string): string {
  return `'${token.replace(/'/g, `'\\''`)}'`;
}

/**
 * Build the single command string handed to `script -qec`, which a
 * shell re-parses. Every token is shell-quoted because the binary can
 * be an absolute path to node plus a bundled script path (see
 * mmx-bridge's resolveMmxInvocation) — either of which may contain
 * spaces on some systems.
 *
 * Exported for unit testing.
 */
export function buildPtyCommand(binary: string, argv: string[]): string {
  return [binary, ...argv].map(shQuote).join(' ');
}

/**
 * Default `isInstalled` implementation: spawn `<binary> --version`
 * and check exit code 0.
 */
export async function defaultIsInstalled(binary: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = spawn(binary, ['--version'], { stdio: 'ignore' });
    probe.on('error', () => resolve(false));
    probe.on('exit', (code) => resolve(code === 0));
  });
}

/**
 * Helper for descriptors: read a JSON config file and return it typed
 * (or null on missing/invalid).
 */
export function readJsonConfig(
  configPath: PathLike,
): Record<string, unknown> | null {
  if (!existsSync(configPath)) return null;
  try {
    const raw = readFileSync(configPath, 'utf-8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}
