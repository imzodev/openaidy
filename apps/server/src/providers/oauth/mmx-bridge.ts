import { spawn, type ChildProcess } from 'node:child_process';
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';

/**
 * Bridge to the official MiniMax CLI (`mmx-cli`).
 *
 * MiniMax's official CLI is the only first-party tool that can perform
 * the device-code OAuth flow against MiniMax's auth server. The endpoints
 * are NOT publicly documented — they require a special `client_id` that
 * mmx-cli ships with.
 *
 * We don't reimplement the OAuth flow (we can't — the endpoints need the
 * mmx-cli client_id). Instead, we spawn `mmx auth login` as a subprocess
 * and:
 *   1. Parse the user_code it prints to stderr
 *   2. Show the verification URL to the user in our dialog
 *   3. Poll `~/.mmx/config.json` until `oauth` is populated
 *   4. Read the tokens and persist them in our encrypted store
 *
 * The user only ever sees the verification URL — they don't have to
 * install mmx interactively; we handle that as a server-side dep.
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
export type SpawnMmxLoginOptions = {
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

/** Spawned process handle returned by `spawnMmxLogin`. */
export type MmxLoginHandle = {
  /** Resolves when the user completes auth (or fails/times out). */
  done: Promise<MiniMaxLoginResult>;
  /** The user_code that mmx printed, once mmx has printed it. */
  userCode: Promise<string>;
  /** The verification URL the user should open. */
  verificationUrl: Promise<string>;
  /** Kill the mmx process (e.g. on user cancel). Idempotent. */
  cancel: () => void;
};

/**
 * Check whether mmx-cli is installed and on PATH.
 */
export async function isMmxInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = spawn('mmx', ['--version'], { stdio: 'ignore' });
    probe.on('error', () => resolve(false));
    probe.on('exit', (code) => resolve(code === 0));
  });
}

/**
 * Spawn `mmx auth login --recommend --region=<region>` and resolve when
 * the user completes auth. The user_code is parsed from mmx's stderr
 * and exposed via `handle.userCode` and `handle.verificationUrl`.
 */
export function spawnMmxLogin(options: SpawnMmxLoginOptions): MmxLoginHandle {
  const configPath = options.configPath ?? MMX_CONFIG_PATH;
  const _pollIntervalMs = options.pollIntervalMs ?? 2_000;
  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000; // 10 min

  let resolveUserCode: (v: string) => void;
  let rejectUserCode: (e: Error) => void;
  const userCode = new Promise<string>((res, rej) => {
    resolveUserCode = res;
    rejectUserCode = rej;
  });

  let child: ChildProcess | null = null;
  let cancelled = false;

  // Strip any stale api_key from the persistent mmx config file
  // before spawning. `mmx` reads `~/.mmx/config.json` at startup
  // and re-injects any api_key it finds there into its env —
  // which would force non-interactive mode (just like a real
  // env var would). We delete the api_key from the config so
  // mmx enters the interactive (browser) flow.
  try {
    const configPath = MMX_CONFIG_PATH;
    if (existsSync(configPath)) {
      const raw = readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(raw) as { api_key?: unknown };
      if (parsed.api_key) {
        delete parsed.api_key;
        writeFile(configPath, JSON.stringify(parsed, null, 2), 'utf-8');
        chmod(configPath, 0o600).catch(() => undefined);
      }
    }
  } catch (err) {
    // non-fatal: if we can't scrub the api_key, mmx may still
    // launch in non-interactive mode. Log the error so it shows
    // up in server logs.
    console.error(
      `spawnMmxLogin: failed to scrub api_key from mmx config: ${(err as Error).message}`,
    );
  }

  const done = new Promise<MiniMaxLoginResult>((resolve) => {
    const finish = (r: MiniMaxLoginResult) => {
      if (child && !child.killed) {
        try {
          child.kill('SIGTERM');
        } catch {
          // best effort
        }
      }
      resolve(r);
    };

    // User cancelled via signal
    options.signal?.addEventListener('abort', () => {
      cancelled = true;
      finish({
        ok: false,
        error: 'cancelled',
        message: 'Cancelled by user',
      });
    });

    // Spawn `mmx auth login` inside a pseudo-TTY so it enters the
    // interactive (browser) flow. Without a TTY, `mmx` forces
    // non-interactive mode and demands `--api-key`, which defeats
    // the whole purpose of OAuth.
    //
    // We use `script(1)` (util-linux) to provide the PTY. Its
    // `-qec` flags silence the bash intro and run the command
    // in-place, exiting when the command exits.
    //
    // Env handling: we strip any MiniMax-related env vars (which
    // would also force non-interactive mode) and pass the rest
    // of process.env through.
    //
    // We deliberately do NOT pass `--output json`. With that flag,
    // `mmx` forces non-interactive mode and requires `--api-key`.
    // Without it, `mmx` uses the interactive/browser flow and
    // prints the user_code + verification URL on stdout.
    try {
      const childEnv: NodeJS.ProcessEnv = { ...process.env };
      // Strip MiniMax-related env vars (defense in depth — mmx
      // forces non-interactive mode if it sees an API key in env).
      delete childEnv['MINIMAX_API_KEY'];
      delete childEnv['MMX_API_KEY'];
      delete childEnv['MMX_OAUTH_TOKEN'];
      delete childEnv['MINIMAX_OAUTH_TOKEN'];
      // Diagnostic flag so we can verify the parent env didn't have it
      childEnv['OPENAIDY_HAD_MINIMAX_API_KEY'] = process.env['MINIMAX_API_KEY']
        ? 'yes'
        : 'no';
      // mmx reads MMX_CONFIG_DIR to find its config file
      childEnv['MMX_CONFIG_DIR'] = MMX_CONFIG_DIR;
      child = spawn(
        'script',
        [
          '-qec',
          `mmx auth login --recommend --region=${options.region}`,
          '/dev/null',
        ],
        {
          env: childEnv,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
    } catch (err) {
      rejectUserCode(err instanceof Error ? err : new Error(String(err)));
      finish({
        ok: false,
        error: 'mmx_not_installed',
        message: 'Failed to spawn mmx. Is mmx-cli installed?',
      });
      return;
    }

    if (!child) {
      rejectUserCode(new Error('Failed to spawn mmx'));
      finish({
        ok: false,
        error: 'mmx_not_installed',
        message: 'Failed to spawn mmx',
      });
      return;
    }

    // Parse mmx output. Two things we care about:
    //   1. The "Opened: <url>" line (stderr) — gives us user_code + URL
    //   2. The final JSON object (stdout) — gives us the result

    let stderrBuf = '';
    let stdoutBuf = '';
    let userCodeResolved = false;

    // mmx (running inside a PTY) prints to STDOUT, but it may
    // also write to STDERR. We apply the same parser to both
    // streams so we don't miss the user_code regardless of where
    // mmx sends it.
    //
    // Pattern: `Opened: <url>` (the URL has user_code as a query
    // param) or `Code: <code>` (just the bare code, fallback).
    const tryParseUserCode = () => {
      if (userCodeResolved) return;
      const combined = stdoutBuf + '\n' + stderrBuf;
      const urlMatch = combined.match(/Opened:\s+(https?:\S+)/);
      let code: string | null = null;
      if (urlMatch) {
        try {
          code = new URL(urlMatch[1]!).searchParams.get('user_code');
        } catch {
          // fall through
        }
      }
      if (!code) {
        const codeMatch = combined.match(/(?:^|\n)\s*Code:\s*([A-Z0-9-]+)/i);
        const m = codeMatch?.[1];
        if (m) code = m;
      }
      if (urlMatch && code) {
        userCodeResolved = true;
        const finalCode: string = code;
        resolveUserCode(finalCode);
      }
    };

    child.stdout?.on('data', (chunk) => {
      const s = chunk.toString();
      stdoutBuf += s;
      tryParseUserCode();
    });

    child.stderr?.on('data', (chunk) => {
      const s = chunk.toString();
      stderrBuf += s;
      tryParseUserCode();
    });

    child.on('error', (err) => {
      rejectUserCode(err);
      finish({
        ok: false,
        error: 'mmx_failed',
        message: err.message,
      });
    });

    child.on('exit', (code) => {
      if (cancelled) return; // already resolved as 'cancelled'
      if (code === 0) {
        // mmx exited cleanly. The config file should now have tokens.
        const tokens = readMmxTokens(configPath);
        if (tokens) {
          finish({ ok: true, tokens });
        } else {
          finish({
            ok: false,
            error: 'no_credentials',
            message:
              'mmx exited 0 but no oauth tokens were found in config.json',
          });
        }
      } else {
        // Non-zero exit. Try to parse the JSON error from stdout.
        let msg = `mmx exited with code ${code}`;
        try {
          const j = JSON.parse(stdoutBuf);
          if (j && typeof j === 'object' && 'error' in j) {
            const e = (j as { error: { message?: string } }).error;
            if (e?.message) msg = e.message;
          }
        } catch {
          // not JSON, use raw stderr tail
          msg = stderrBuf.trim().split('\n').pop() ?? msg;
        }
        finish({ ok: false, error: 'mmx_failed', message: msg });
      }
    });
  });

  // Polling: in parallel with mmx, we read ~/.mmx/config.json every
  // pollIntervalMs. If we see oauth tokens AND mmx has already given us
  // the user_code, we can resolve done early without waiting for the
  // mmx process to exit (which only happens after the user authorizes).
  //
  // Actually: the simplest contract is that `done` resolves when mmx
  // exits (cleanly or with an error). The HTTP route then reads the
  // tokens from `~/.mmx/config.json` and stores them. We don't need
  // early-exit polling here.

  // Timeout
  if (timeoutMs > 0) {
    setTimeout(() => {
      if (child && !child.killed && !cancelled) {
        try {
          child.kill('SIGTERM');
        } catch {
          // ignore
        }
        // Killing the child triggers its exit handler, which resolves
        // `done` (see the `child.on('exit', ...)` block above). So the
        // timeout is implicit — no explicit resolve needed here.
        void done;
      }
    }, timeoutMs).unref();
  }

  return {
    done,
    userCode,
    verificationUrl: userCode.then(
      (code) =>
        `https://platform.minimax.io/oauth-authorize?user_code=${code}&client=OpenAidy`,
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
 * Read tokens from mmx-cli's config file. Returns null if no oauth
 * entry is present or the file doesn't exist.
 */
export function readMmxTokens(
  configPath: string = MMX_CONFIG_PATH,
): MiniMaxOAuthTokens | null {
  if (!existsSync(configPath)) return null;
  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as MmxConfigFile;
    if (parsed.oauth?.access_token && parsed.oauth?.refresh_token) {
      return parsed.oauth;
    }
    return null;
  } catch {
    return null;
  }
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
