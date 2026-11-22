#!/usr/bin/env node
/**
 * Builds the publishable `@aidyagent/app` npm package into build/npm/.
 *
 * Distribution model: instead of cloning + building from source on the user's
 * machine (fragile — pnpm/corepack/native-toolchain issues), we ship a
 * prebuilt package. `npm install -g @aidyagent/app` then `aidy start` runs with
 * zero build step.
 *
 * Layout produced:
 *   build/npm/
 *     package.json        name "@aidyagent/app", bin, deps (third-party)
 *     dist/server.mjs     esbuild bundle of apps/server (@aidyagent/* inlined)
 *     dist/cli.mjs        esbuild bundle of the CLI (bin, shebang)
 *     web/                apps/web/dist (the built SPA)
 *     assets/aidy.template.json
 *     assets/aidy-sdk.js
 *     assets/drizzle/*.sql
 *     assets/skills/      pre-installed skill definitions (browser-automation,
 *                          code-review, conventional-commits, …) — see
 *                          config/skills/. The packaged CLI points the server
 *                          at this directory via BUNDLED_SKILLS_DIR so a fresh
 *                          install seeds the user's ~/.aidy/skills/ from
 *                          here, with the existing per-file manifest handling
 *                          version updates and user-edit preservation.
 *
 * First-party @aidyagent/* code is bundled in; third-party deps stay external
 * and are declared as `dependencies` so npm installs them. There are no native
 * addons — the SQLite layer uses Node's built-in `node:sqlite` — so nothing
 * needs a compiler or a postinstall script (safe under npm v12's script
 * defaults). Requires Node >= 22.13 (node:sqlite without a flag).
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  cpSync,
  existsSync,
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
// minus first-party @aidyagent/* (those are inlined by esbuild).
const depSources = [
  'apps/server/package.json',
  'packages/db/package.json',
  'packages/cli/package.json',
];
const deps = {};
for (const src of depSources) {
  const d = readPkg(src).dependencies ?? {};
  for (const [name, range] of Object.entries(d)) {
    if (!name.startsWith('@aidyagent/')) deps[name] = range;
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
  entryPoints: [resolve(root, 'packages/cli/bin/aidy.ts')],
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
  resolve(root, 'config/aidy.template.json'),
  resolve(out, 'assets/aidy.template.json'),
);
cpSync(
  resolve(root, 'apps/server/src/sdk/aidy-sdk.js'),
  resolve(out, 'assets/aidy-sdk.js'),
);
cpSync(resolve(root, 'packages/db/drizzle'), resolve(out, 'assets/drizzle'), {
  recursive: true,
});
// Bundled pre-installed skills (config/skills/). The packaged CLI passes
// `<pkgRoot>/assets/skills` to the server via BUNDLED_SKILLS_DIR; the server
// seeds ~/.aidy/skills/ from there on every start, so skill updates
// ship with the next npm upgrade (the existing per-file manifest at
// ~/.aidy/skills/.seed-manifest.json handles new / version-bumped /
// user-modified files correctly).
const skillsSource = resolve(root, 'config/skills');
if (!existsSync(skillsSource)) {
  throw new Error(
    `Bundled skills source not found at ${skillsSource}. ` +
      `Pre-installed skills must exist before building the package.`,
  );
}
cpSync(skillsSource, resolve(out, 'assets/skills'), {
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
  // Scoped under the @aidyagent org: the unscoped `aidy` name is taken on npm.
  // The `bin` name is `aidy`, so users run `aidy` regardless of the (scoped)
  // install name.
  name: '@aidyagent/app',
  version: rootPkg.version,
  description: 'Aidy — self-hosted AI agent platform (prebuilt).',
  type: 'module',
  bin: { aidy: './dist/cli.mjs' },
  files: ['dist', 'web', 'assets', 'README.md'],
  engines: { node: '>=22.13.0' },
  // Required for npm provenance (OIDC trusted publishing): must match the repo
  // that builds/publishes the package.
  repository: {
    type: 'git',
    url: 'git+https://github.com/imzodev/aidy.git',
  },
  dependencies: deps,
  // Scoped packages default to restricted; make it public.
  publishConfig: { access: 'public' },
  license: rootPkg.license ?? 'UNLICENSED',
};
writeFileSync(resolve(out, 'package.json'), JSON.stringify(pkg, null, 2));
writeFileSync(
  resolve(out, 'README.md'),
  `# @aidyagent/app\n\nPrebuilt Aidy. Install and run:\n\n\`\`\`\nnpm install -g @aidyagent/app\naidy start\n\`\`\`\n`,
);

console.log(
  `[build-npm] done → ${out}\n  version ${pkg.version}, ${external.length} runtime deps`,
);
