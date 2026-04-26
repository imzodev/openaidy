import { spawn } from 'node:child_process';
import { createLogger } from '../lib/logger';

const log = createLogger('exec');

export interface ExecServiceOptions {
  /** Maximum wall-clock time in ms before the process is killed. Default: 30 000 */
  timeoutMs?: number;
  /** Maximum bytes captured from stdout + stderr. Default: 1 MB */
  maxOutputBytes?: number;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_024 * 1_024; // 1 MB

/**
 * ExecService
 *
 * Runs a shell command in a subprocess and returns captured output.
 * Commands are spawned via /bin/sh -c to support pipes and redirects,
 * but callers are responsible for only exposing this to trusted agents.
 */
export class ExecService {
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;

  constructor(options: ExecServiceOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  }

  run(command: string, cwd?: string): Promise<ExecResult> {
    return new Promise((resolve) => {
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let totalBytes = 0;
      let timedOut = false;

      log.debug('exec: spawning command', { command, cwd });

      const child = spawn('/bin/sh', ['-c', command], {
        cwd,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, this.timeoutMs);

      const collect = (chunks: Buffer[]) => (data: Buffer) => {
        if (totalBytes >= this.maxOutputBytes) return;
        const remaining = this.maxOutputBytes - totalBytes;
        const slice =
          data.length > remaining ? data.subarray(0, remaining) : data;
        chunks.push(slice);
        totalBytes += slice.length;
      };

      child.stdout.on('data', collect(stdoutChunks));
      child.stderr.on('data', collect(stderrChunks));

      child.on('close', (code) => {
        clearTimeout(timer);
        const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
        const stderr = Buffer.concat(stderrChunks).toString('utf-8');
        const exitCode = code ?? (timedOut ? 124 : 1);

        log.debug('exec: command finished', { command, exitCode, timedOut });

        resolve({ stdout, stderr, exitCode, timedOut });
      });
    });
  }
}

export function createExecService(options?: ExecServiceOptions): ExecService {
  return new ExecService(options);
}
