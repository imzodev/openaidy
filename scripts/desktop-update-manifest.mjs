#!/usr/bin/env node
// Builds the `latest.json` the desktop app's updater (apps/desktop/src-tauri
// — see tauri.conf.json's plugins.updater.endpoints) polls on every launch.
// Tauri's bundler produces a signature file (`.sig`) next to each
// update-capable artifact when TAURI_SIGNING_PRIVATE_KEY is set at build
// time (release.yml); this script turns those into the manifest the
// updater plugin actually understands. Not every bundle format is
// update-capable — .deb/.rpm are package-manager-installed, not
// self-replacing, so only the NSIS installer (Windows) and the
// .app.tar.gz (macOS — a separate artifact from the user-facing .dmg)
// ever get a `.sig`. Linux has no updater-capable format at all right
// now: AppImage would have been the one, but its bundler (linuxdeploy)
// proved too unreliable in CI to ship (see tauri.conf.json's bundle
// section) — Linux users update by re-downloading .deb/.rpm manually.
//
// Two subcommands, run from repo root:
//   fragment <platform-name> <out-file>
//     Scans apps/desktop/src-tauri/target/**/bundle/**/*.sig produced by
//     the build that just ran on this matrix leg, and writes a partial
//     `{ "<updater-platform-key>": { url, signature } }` object — run once
//     per OS in build-desktop, uploaded as an artifact.
//   merge <version> <notes> <fragment-file...> <out-file>
//     Combines every fragment (one per OS) into the final latest.json —
//     run once in attach-desktop-installers after downloading all of them.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { globSync } from 'node:fs';
import path from 'node:path';

const RELEASE_ASSET_BASE = (tag) =>
  `https://github.com/imzodev/openaidy/releases/download/${tag}`;

// Maps a found artifact's path to the updater's platform key(s) — some
// artifacts (the universal macOS build) serve two keys from one file since
// installed clients report their own concrete arch, not "universal".
function platformKeysFor(sigPath) {
  const normalized = sigPath.replace(/\\/g, '/');
  if (normalized.endsWith('.exe.sig') && normalized.includes('/nsis/')) {
    return ['windows-x86_64'];
  }
  if (normalized.endsWith('.app.tar.gz.sig')) {
    return ['darwin-x86_64', 'darwin-aarch64'];
  }
  // .msi.sig deliberately excluded: NSIS is the canonical Windows
  // auto-update artifact here, and a platform key can only point at one
  // file — no reason to prefer MSI over NSIS for this.
  return [];
}

function cmdFragment(platformName, outFile, tag) {
  const sigFiles = globSync('apps/desktop/src-tauri/target/**/bundle/**/*.sig');
  const fragment = {};
  for (const sigPath of sigFiles) {
    const keys = platformKeysFor(sigPath);
    if (keys.length === 0) continue;
    const signature = readFileSync(sigPath, 'utf8').trim();
    const artifactPath = sigPath.slice(0, -'.sig'.length);
    const url = `${RELEASE_ASSET_BASE(tag)}/${path.basename(artifactPath)}`;
    for (const key of keys) fragment[key] = { signature, url };
  }
  if (Object.keys(fragment).length === 0) {
    console.warn(
      `[desktop-update-manifest] no updater-capable .sig files found for ${platformName} — ` +
        'this platform will be missing from latest.json (users on it get no auto-update prompt).',
    );
  }
  writeFileSync(outFile, JSON.stringify(fragment, null, 2));
  console.log(
    `[desktop-update-manifest] wrote ${outFile}:`,
    Object.keys(fragment),
  );
}

function cmdMerge(version, notes, fragmentFiles, outFile) {
  const platforms = {};
  for (const file of fragmentFiles) {
    if (!existsSync(file)) continue;
    Object.assign(platforms, JSON.parse(readFileSync(file, 'utf8')));
  }
  const manifest = {
    version,
    notes,
    pub_date: new Date().toISOString(),
    platforms,
  };
  writeFileSync(outFile, JSON.stringify(manifest, null, 2));
  console.log(
    `[desktop-update-manifest] wrote ${outFile} covering:`,
    Object.keys(platforms),
  );
  if (Object.keys(platforms).length === 0) {
    console.warn(
      '[desktop-update-manifest] latest.json has no platforms at all — ' +
        'the desktop build must have failed on every OS this release.',
    );
  }
}

const [, , cmd, ...args] = process.argv;
if (cmd === 'fragment') {
  const [platformName, outFile, tag] = args;
  cmdFragment(platformName, outFile, tag);
} else if (cmd === 'merge') {
  const [version, notes, outFile, ...fragmentFiles] = args;
  cmdMerge(version, notes, fragmentFiles, outFile);
} else {
  console.error(
    'Usage:\n' +
      '  desktop-update-manifest.mjs fragment <platform-name> <out-file> <tag>\n' +
      '  desktop-update-manifest.mjs merge <version> <notes> <out-file> <fragment-file...>',
  );
  process.exit(1);
}
