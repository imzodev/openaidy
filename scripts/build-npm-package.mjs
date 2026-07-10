#!/usr/bin/env node
/**
 * Builds the publishable `openaidy` npm package into build/npm/.
 *
 * Distribution model: instead of cloning + building from source on the user's
 * machine (fragile — pnpm/corepack/native-toolchain issues), we ship a
 * prebuilt package. `npm install -g openaidy` then `openaidy start` runs with
 * zero build step.
 *
 * Layout produced:
 *   build/npm/
 *     package.json        name "openaidy", bin, deps (third-party + native)
 *     dist/server.mjs     esbuild bundle of apps/server (@openaidy/* inlined)
 *     dist/cli.mjs        esbuild bundle of the CLI (bin, shebang)
 *     web/                apps/web/dist (the built SPA)
 *     assets/openaidy.template.json
 *     assets/openaidy-sdk.js
 *     assets/drizzle/*.sql
 *
 * First-party @openaidy/* code is bundled in; third-party deps (incl. the
 * native better-sqlite3) stay external and are declared as `dependencies` so
 * npm installs them (better-sqlite3 pulls its prebuilt binary — no compiler).
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'build/npm');
const require = createRequire(resolve(root, 'package.json'));
const esbuild = require('esbuild');

const readPkg = (p) => JSON.parse(readFileSync(resolve(root, p), 'utf-8'));
const rootPkg = readPkg('package.json');

// ── Dependency set: union of third-party deps across the packages we bundle,
// minus first-party @openaidy/* (those are inlined by esbuild).
const depSources = [
  'apps/server/package.json',
  'packages/db/package.json',
  'packages/cli/package.json',
];
const deps = {};
for (const src of depSources) {
  const d = readPkg(src).dependencies ?? {};
  for (const [name, range] of Object.entries(d)) {
    if (!name.startsWith('@openaidy/')) deps[name] = range;
  }
}
const external = Object.keys(deps);

console.log(`[build-npm] cleaning ${out}`);
rmSync(out, { recursive: true, force: true });
mkdirSync(resolve(out, 'dist'), { recursive: true });

// ── Bundle the server.
console.log('[build-npm] bundling server…');
await esbuild.build({
  entryPoints: [resolve(root, 'apps/server/src/server.ts')],
  outfile: resolve(out, 'dist/server.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external,
  logLevel: 'error',
  // Fastify/pino etc. reference `require` in an ESM bundle; shim it.
  banner: {
    js: "import { createRequire as __cjsRequire } from 'node:module'; const require = __cjsRequire(import.meta.url);",
  },
});

// ── Bundle the CLI (bin). It detects packaged mode by finding server.mjs next
// to itself, so keep both in dist/.
console.log('[build-npm] bundling CLI…');
await esbuild.build({
  entryPoints: [resolve(root, 'packages/cli/bin/openaidy.ts')],
  outfile: resolve(out, 'dist/cli.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external,
  logLevel: 'error',
  // esbuild preserves the entry's own `#!/usr/bin/env node` shebang (it must be
  // line 1 for Node to strip it), so the banner only adds the require shim.
  banner: {
    js: "import { createRequire as __cjsRequire } from 'node:module'; const require = __cjsRequire(import.meta.url);",
  },
});

// ── Assets.
console.log('[build-npm] copying assets…');
mkdirSync(resolve(out, 'assets'), { recursive: true });
cpSync(
  resolve(root, 'config/openaidy.template.json'),
  resolve(out, 'assets/openaidy.template.json'),
);
cpSync(
  resolve(root, 'apps/server/src/sdk/openaidy-sdk.js'),
  resolve(out, 'assets/openaidy-sdk.js'),
);
cpSync(resolve(root, 'packages/db/drizzle'), resolve(out, 'assets/drizzle'), {
  recursive: true,
});

// ── Web bundle (must be built first: pnpm --filter web build).
const webDist = resolve(root, 'apps/web/dist');
try {
  cpSync(webDist, resolve(out, 'web'), { recursive: true });
} catch {
  throw new Error(
    `apps/web/dist not found at ${webDist}. Run \`pnpm --filter web build\` before this script.`,
  );
}

// ── package.json for the published package.
const pkg = {
  // Scoped under the @openaidy org: npm's typosquat filter blocks the unscoped
  // `openaidy` (too close to `openai`). The `bin` name stays `openaidy`, so
  // users still run `openaidy` regardless of the (scoped) install name.
  name: '@openaidy/app',
  version: rootPkg.version,
  description: 'OpenAidy — self-hosted AI agent platform (prebuilt).',
  type: 'module',
  bin: { openaidy: './dist/cli.mjs' },
  files: ['dist', 'web', 'assets', 'README.md'],
  engines: { node: '>=22.12.0' },
  // Required for npm provenance (OIDC trusted publishing): must match the repo
  // that builds/publishes the package.
  repository: {
    type: 'git',
    url: 'git+https://github.com/imzodev/openaidy.git',
  },
  dependencies: deps,
  // Scoped packages default to restricted; make it public.
  publishConfig: { access: 'public' },
  license: rootPkg.license ?? 'UNLICENSED',
};
writeFileSync(resolve(out, 'package.json'), JSON.stringify(pkg, null, 2));
writeFileSync(
  resolve(out, 'README.md'),
  `# @openaidy/app\n\nPrebuilt OpenAidy. Install and run:\n\n\`\`\`\nnpm install -g @openaidy/app\nopenaidy start\n\`\`\`\n`,
);

console.log(
  `[build-npm] done → ${out}\n  version ${pkg.version}, ${external.length} runtime deps`,
);
