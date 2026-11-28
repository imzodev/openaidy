# Releasing Aidy

Aidy ships as a **prebuilt npm package**, `@aidyagent/app`, plus **desktop
installers** attached to a GitHub Release. The one-liner installers
(`install.sh` / `install.ps1`) run `npm install -g @aidyagent/app`, and a
running install updates itself the same way, so a successful npm publish is
what end users actually get:

```
curl -fsSL https://aidyagent.app/install.sh | bash
```

## Versioning

The product version lives in the root `package.json` `version` field and is the
single source of truth; the published npm package takes its version from it.
Tags are `vMAJOR.MINOR.PATCH` (e.g. `v0.4.0`) and must match that version.
Pre-1.0, treat minor as "features or breaking changes" and patch as "fixes".

## Cut a release

1. Make sure `main` is green (CI passes) and is the commit you want to ship.
2. Bump the version in the root `package.json` through a PR, the same as any
   other change (`main` is protected):
   ```
   chore(release): bump version to 0.4.1
   ```
3. After it merges, tag the merge commit on `main` and push the tag:
   ```
   git checkout main && git pull
   git tag v0.4.1
   git push origin v0.4.1
   ```

Pushing the `v*.*.*` tag triggers `.github/workflows/release.yml`:

| Job                         | Needs                      | What it does                                                                                                                                 |
| --------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `gate`                      | —                          | Re-runs ESLint, typecheck/build and tests.                                                                                                   |
| `publish-npm`               | `gate`                     | Builds `build/npm` (`pnpm build:npm`) and publishes `@aidyagent/app` via npm trusted publishing (OIDC). Skips if the version already exists. |
| `build-desktop`             | `gate`                     | Builds the Tauri desktop installers for Windows, macOS and Linux (best-effort, one platform failing doesn't block the others).               |
| `release`                   | `gate`, `publish-npm`      | Creates the GitHub Release with auto-generated notes. **Only runs if the npm publish succeeded.**                                            |
| `attach-desktop-installers` | `release`, `build-desktop` | Uploads whichever desktop installers built to the release.                                                                                   |

If the workflow fails after the gate, fix the cause and re-run it from the
Actions tab (**Run workflow** → enter the existing tag). Every step is
idempotent: an already-published npm version and an existing release are
skipped.

## One-time setup

- **npm:** the `@aidyagent` org must exist, and `@aidyagent/app` must have a
  **Trusted Publisher** pointing at this repo and `release.yml`. Trusted
  publishing is configured per package, so the very first publish of a new
  package name has to be done manually with a token (`pnpm build:npm`, then
  `npm publish --access public` from `build/npm`); every later release
  publishes from CI with no long-lived token.
- **Desktop updater signing:** repository secrets `TAURI_SIGNING_PRIVATE_KEY`
  and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. This signs the auto-update payload
  only. The installers are not OS code-signed yet, so SmartScreen/Gatekeeper
  warn on first launch (see `docs/desktop/DEPENDENCIES.md`).

## What users get

- **Server / CLI:** `install.sh` / `install.ps1` install the latest
  `@aidyagent/app` from npm. Pin a version with `--version 0.4.0`
  (`-Version 0.4.0` on Windows).
- **Self-update:** Settings → About runs `npm install -g @aidyagent/app@latest`
  and restarts.
- **Desktop:** installers from the GitHub Release; installed apps update
  themselves from the release's `latest.json`.
