import { spawn } from 'node:child_process';
import { createLogger } from '../lib/logger';
import { buildScrubbedEnv } from './env';

const log = createLogger('exec');

export interface ExecServiceOptions {
  /** Maximum wall-clock time in ms before the process is killed. Default: 30 000 */
  timeoutMs?: number;
  /** Maximum bytes captured from stdout + stderr. Default: 1 MB */
  maxOutputBytes?: number;
  /**
   * Extra environment variable names to expose to spawned commands, on top of
   * the non-secret baseline allowlist. Use sparingly — anything added here is
   * readable by every command the agent runs.
   */
  envAllowlist?: string[];
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  /**
   * True when the run was aborted via the caller's AbortSignal (user Stop).
   * `exitCode` is 130 (conventional "terminated by signal") in that case.
   */
  cancelled?: boolean;
}

export interface ExecRunOptions {
  /** Abort the run (SIGTERM, then SIGKILL after a short grace period). */
  signal?: AbortSignal;
  /** Called for each captured stdout/stderr chunk as it arrives (live output). */
  onOutput?: (chunk: { stream: 'stdout' | 'stderr'; data: string }) => void;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_024 * 1_024; // 1 MB

/**
 * Patterns that are unconditionally rejected before spawning.
 * These are high-confidence destructive or privilege-escalating operations.
 */
const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\brm\s+(-[^\s]*f[^\s]*\s+|.*\s+-[^\s]*f[^\s]*\s+)?-[^\s]*r/i,
    reason: 'recursive delete (rm -r / rm -rf)',
  },
  { pattern: /\brm\b.*\s+\/(?:\s|$)/, reason: 'delete from filesystem root' },
  { pattern: /\bdd\b.*\bof=\/dev\//i, reason: 'raw device write via dd' },
  { pattern: /:\(\){.*};:/, reason: 'fork bomb' },
  { pattern: /\bsudo\b/i, reason: 'sudo — privilege escalation' },
  { pattern: /\bsu\s/i, reason: 'su — user switch' },
  {
    pattern: /\bchmod\s+[0-9]*7[^\s]*\s+\//,
    reason: 'chmod on filesystem root',
  },
  { pattern: /\bmkfs\b/i, reason: 'filesystem format' },
  { pattern: /\bshred\b/i, reason: 'secure delete' },
  { pattern: />\/dev\/sd[a-z]/, reason: 'write to raw block device' },
  {
    pattern: />\/dev\/(zero|null|urandom)\s*$/,
    reason: 'redirect to dangerous device',
  },
];

const IS_WINDOWS = process.platform === 'win32';
const SHELL = IS_WINDOWS ? 'cmd.exe' : '/bin/sh';
const SHELL_FLAG = IS_WINDOWS ? '/c' : '-c';

/**
 * ExecService
 *
 * Runs a shell command in a subprocess and returns captured output.
 * On Unix, commands are spawned via /bin/sh -c; on Windows via cmd.exe /c.
 * Callers are responsible for only exposing this to trusted agents.
 */
export class ExecService {
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;
  /** Scrubbed environment handed to every spawned command (no secrets). */
  private readonly env: NodeJS.ProcessEnv;

  constructor(options: ExecServiceOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    this.env = buildScrubbedEnv(process.env, options.envAllowlist ?? []);
  }

  /**
   * Check a command against the blocklist.
   * Returns a reason string if blocked, undefined if allowed.
   */
  checkCommand(command: string): string | undefined {
    for (const { pattern, reason } of DANGEROUS_PATTERNS) {
      if (pattern.test(command)) {
        return reason;
      }
    }
    return undefined;
  }

  run(
    command: string,
    cwd?: string,
    options?: ExecRunOptions,
  ): Promise<ExecResult> {
    const blocked = this.checkCommand(command);
    if (blocked) {
      return Promise.resolve({
        stdout: '',
        stderr: `Command blocked: ${blocked}`,
        exitCode: 1,
        timedOut: false,
      });
    }

    const signal = options?.signal;
    const onOutput = options?.onOutput;

    // Already-cancelled before we even spawn.
    if (signal?.aborted) {
      return Promise.resolve({
        stdout: '',
        stderr: 'Cancelled by user',
        exitCode: 130,
        timedOut: false,
        cancelled: true,
      });
    }

    return new Promise((resolve) => {
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let totalBytes = 0;
      let timedOut = false;
      let cancelled = false;
      let settled = false;

      log.debug('exec: spawning command', { command, cwd });

      const child = spawn(SHELL, [SHELL_FLAG, command], {
        cwd,
        // Scrubbed env — never the server's full process.env (which holds
        // DB creds, JWT secret, credential master key, provider API keys).
        env: this.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, this.timeoutMs);

      // User cancel: SIGTERM, then SIGKILL after a 2s grace period (mirrors the
      // timeout escalation). We never skip SIGTERM, even on an explicit Stop.
      let graceTimer: NodeJS.Timeout | undefined;
      const onAbort = () => {
        cancelled = true;
        child.kill('SIGTERM');
        graceTimer = setTimeout(() => child.kill('SIGKILL'), 2_000);
      };
      if (signal) signal.addEventListener('abort', onAbort, { once: true });

      const cleanup = () => {
        clearTimeout(timer);
        if (graceTimer) clearTimeout(graceTimer);
        if (signal) signal.removeEventListener('abort', onAbort);
      };

      const collect =
        (chunks: Buffer[], stream: 'stdout' | 'stderr') => (data: Buffer) => {
          if (totalBytes >= this.maxOutputBytes) return;
          const remaining = this.maxOutputBytes - totalBytes;
          const slice =
            data.length > remaining ? data.subarray(0, remaining) : data;
          chunks.push(slice);
          totalBytes += slice.length;
          if (onOutput) onOutput({ stream, data: slice.toString('utf-8') });
        };

      child.stdout.on('data', collect(stdoutChunks, 'stdout'));
      child.stderr.on('data', collect(stderrChunks, 'stderr'));

      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({
          stdout: '',
          stderr: `Failed to spawn command: ${err.message}`,
          exitCode: 1,
          timedOut: false,
        });
      });

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        cleanup();
        const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
        const stderr = Buffer.concat(stderrChunks).toString('utf-8');
        const exitCode = cancelled ? 130 : (code ?? (timedOut ? 124 : 1));

        log.debug('exec: command finished', {
          command,
          exitCode,
          timedOut,
          cancelled,
        });

        resolve({ stdout, stderr, exitCode, timedOut, cancelled });
      });
    });
  }
}

export function createExecService(options?: ExecServiceOptions): ExecService {
  return new ExecService(options);
}
