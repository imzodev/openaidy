#!/usr/bin/env node
// tauri.conf.json's beforeBuildCommand — bundles apps/server (source + prod
// node_modules, via `pnpm deploy`) into apps/desktop/src-tauri/server-bundle
// so a packaged build has something to actually spawn (see service.rs's
// locate_server_entry doc comment), copies the repo's shared config/ in
// alongside it, then builds the web frontend.
//
// A plain `rmSync(dir) && pnpm deploy dir` one-liner (what this replaced)
// intermittently failed on Windows with pnpm's own
// ERR_PNPM_DEPLOY_DIR_NOT_EMPTY — reproduced both locally and in CI.
// fs.rmSync can return before NTFS has actually finished removing a
// deeply-nested directory (the deploy output includes a full prod
// node_modules tree), so the very next command sometimes still finds
// leftover content. Retrying the removal until the path is confirmed gone
// (or a generous timeout elapses) avoids the race; a plain recursive
// rmSync is enough on Linux/macOS, which don't have this quirk, so the
// retry loop is just a no-op extra check there.

import { rmSync, existsSync, cpSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const SERVER_BUNDLE_DIR = 'apps/desktop/src-tauri/server-bundle';

function sleepSync(ms) {
  // No async/await here — this whole script runs as a single sequential
  // beforeBuildCommand step, so a synchronous sleep keeps it simple.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function removeServerBundleDir() {
  const deadline = Date.now() + 15_000;
  for (;;) {
    rmSync(SERVER_BUNDLE_DIR, { recursive: true, force: true });
    if (!existsSync(SERVER_BUNDLE_DIR)) return;
    if (Date.now() >= deadline) {
      throw new Error(
        `${SERVER_BUNDLE_DIR} still exists after repeated rmSync attempts — ` +
          'a file inside it is likely locked by another process.',
      );
    }
    sleepSync(100);
  }
}

function run(command, args) {
  console.log(`[desktop-prebuild] ${command} ${args.join(' ')}`);
  execFileSync(command, args, { stdio: 'inherit', shell: true });
}

function deployServerBundle() {
  const deployArgs = [
    '--filter',
    '@openaidy/server',
    'deploy',
    '--prod',
    '--legacy',
    SERVER_BUNDLE_DIR,
  ];
  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      run('pnpm', deployArgs);
      return;
    } catch (err) {
      if (attempt === attempts) throw err;
      console.warn(
        `[desktop-prebuild] pnpm deploy attempt ${attempt}/${attempts} failed ` +
          `(likely the same Windows removal race removeServerBundleDir() ` +
          `guards against above) — clearing the dir and retrying.`,
      );
      removeServerBundleDir();
    }
  }
}

removeServerBundleDir();
deployServerBundle();
cpSync('config', `${SERVER_BUNDLE_DIR}/shared-config`, { recursive: true });
run('pnpm', ['--filter', 'web', 'build']);
