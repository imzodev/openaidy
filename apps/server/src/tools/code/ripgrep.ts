import { spawn } from 'node:child_process';

/**
 * Error thrown when ripgrep isn't on PATH. Surfaced to the agent as a
 * clear installation hint so the user can fix the environment instead of
 * the tool silently doing nothing.
 */
export class RipgrepNotFoundError extends Error {
  constructor() {
    super(
      'ripgrep (rg) is not installed. Install it:\n' +
        '  macOS:   brew install ripgrep\n' +
        '  Debian:  sudo apt install ripgrep\n' +
        '  Fedora:  sudo dnf install ripgrep\n' +
        '  Arch:    sudo pacman -S ripgrep\n' +
        '  Windows: winget install BurntSushi.ripgrep  (or  choco install ripgrep  /  scoop install ripgrep)',
    );
    this.name = 'RipgrepNotFoundError';
  }
}

export interface RunRipgrepOptions {
  /** Working directory. ripgrep resolves relative paths from here. */
  cwd: string;
  /** Max stdout to buffer (bytes). rg can produce a lot on big searches. */
  maxOutputBytes?: number;
  /** Kill the child after this many ms. Default 30s. */
  timeoutMs?: number;
}

export interface RunRipgrepResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** True when ripgrep found no matches (exit code 1). Not an error. */
  noMatches: boolean;
}

/**
 * Spawn ripgrep and wait for it to finish. Surfaces ENOENT as
 * `RipgrepNotFoundError` so the caller can return a user-facing message.
 *
 * ripgrep exit codes:
 *   0 — match found
 *   1 — no match (NOT an error)
 *   2 — real error (bad regex, permission denied, etc.)
 */
export function runRipgrep(
  args: string[],
  options: RunRipgrepOptions,
): Promise<RunRipgrepResult> {
  const maxOutput = options.maxOutputBytes ?? 50 * 1024 * 1024;
  const timeoutMs = options.timeoutMs ?? 30_000;

  return new Promise((resolve, reject) => {
    const child = spawn('rg', args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdoutTruncated) return;
      if (stdout.length + chunk.length > maxOutput) {
        stdoutTruncated = true;
        stdout += chunk.toString('utf-8', 0, maxOutput - stdout.length);
        stdout += '\n[output truncated]';
        return;
      }
      stdout += chunk.toString('utf-8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderrTruncated) return;
      if (stderr.length + chunk.length > 64 * 1024) {
        stderrTruncated = true;
        stderr += chunk.toString('utf-8', 0, 64 * 1024 - stderr.length);
        stderr += '\n[stderr truncated]';
        return;
      }
      stderr += chunk.toString('utf-8');
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`ripgrep timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new RipgrepNotFoundError());
      } else {
        reject(err);
      }
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 0,
        noMatches: code === 1,
      });
    });
  });
}
