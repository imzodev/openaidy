#!/usr/bin/env node
/**
 * Concurrent dev runner for the monorepo.
 *
 * Why this exists instead of `pnpm --parallel`: on Windows, piping through
 * pnpm's parallel orchestrator drops or buffers child stdout in a way that
 * leaves `tsx watch` hanging during Fastify's `app.listen()`. Spawning the
 * two dev scripts directly via Node preserves the TTY/pipe semantics each
 * child expects and lets us forward SIGINT/SIGTERM to both.
 */
import { spawn } from 'node:child_process';
import process from 'node:process';

const isWindows = process.platform === 'win32';
const children = [
  { name: 'server', color: '\x1b[34m', cmd: 'pnpm', args: ['dev:server'] },
  { name: 'web', color: '\x1b[35m', cmd: 'pnpm', args: ['dev:web'] },
];

const procs = children.map(({ name, color, cmd, args }) => {
  const child = spawn(cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: isWindows,
    env: process.env,
  });
  const prefix = `${color}[${name}]\x1b[0m `;
  const relay = (stream, target) => {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) target.write(`${prefix}${line}\n`);
    });
    stream.on('end', () => {
      if (buffer.length > 0) target.write(`${prefix}${buffer}\n`);
    });
  };
  relay(child.stdout, process.stdout);
  relay(child.stderr, process.stderr);
  child.on('exit', (code, signal) => {
    process.stdout.write(
      `${prefix}exited code=${code ?? 'null'} signal=${signal ?? 'null'}\n`,
    );
    for (const other of procs) {
      if (other !== child && other.exitCode === null && !other.killed) {
        other.kill('SIGTERM');
      }
    }
    process.exit(code ?? 1);
  });
  return child;
});

const shutdown = (signal) => {
  for (const child of procs) {
    if (child.exitCode === null && !child.killed) child.kill(signal);
  }
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
