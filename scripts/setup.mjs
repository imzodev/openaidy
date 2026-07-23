#!/usr/bin/env node
/**
 * One-shot setup for local development.
 *
 * Compresses the "clone → run" path down to a single command:
 *
 *   1. Ensure a root `.env` exists (copy from `.env.example` if missing).
 *   2. Install dependencies with pnpm.
 *
 * OpenAidy is otherwise zero-config: SQLite is the default database and the
 * JWT signing secret + credentials master key are generated and persisted
 * automatically on first boot, so there is no secret to paste by hand.
 *
 * After this finishes, `pnpm dev` starts the server and web UI together.
 */
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(repoRoot, '.env');
const envExamplePath = resolve(repoRoot, '.env.example');

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

function step(msg) {
  process.stdout.write(`\n${bold('▸')} ${msg}\n`);
}

function ensureEnv() {
  step('Checking .env');
  if (existsSync(envPath)) {
    process.stdout.write('  .env already exists — leaving it untouched.\n');
    return;
  }
  if (!existsSync(envExamplePath)) {
    process.stdout.write(
      yellow('  .env.example not found — skipping .env creation.\n'),
    );
    return;
  }
  copyFileSync(envExamplePath, envPath);
  process.stdout.write(
    green('  Created .env from .env.example.') +
      ' Add a provider API key when ready (or use Settings → Providers).\n',
  );
}

function run(cmd, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      cwd: repoRoot,
      env: process.env,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else
        reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

async function main() {
  ensureEnv();

  step('Installing dependencies (pnpm install)');
  await run('pnpm', ['install']);

  process.stdout.write(
    `\n${green('✓ Setup complete.')}\n\n` +
      `Next steps:\n` +
      `  1. (Optional) Add a provider API key in ${bold('.env')} or via Settings → Providers.\n` +
      `  2. Start the app:  ${bold('pnpm dev')}\n\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`\n${yellow('Setup failed:')} ${err.message}\n`);
  process.exit(1);
});
