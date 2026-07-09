# Releasing OpenAidy

OpenAidy ships as a source install: the installer clones a git ref, builds it,
and runs it. A "release" is therefore a **git tag** plus a **GitHub Release**,
not an npm publish. The one-liner installer resolves the newest release tag by
default, so cutting a release is what end users get from:

```
curl -fsSL https://openaidy.com/install.sh | bash
```

## Versioning

The product version lives in the root `package.json` `version` field and is the
single source of truth. Tags are `vMAJOR.MINOR.PATCH` (e.g. `v0.1.0`) and must
match that version. Pre-1.0, treat minor as "features" and patch as "fixes".

## Cut a release

1. Make sure `main` is green (CI passes) and is the commit you want to ship.
2. Bump the version in the root `package.json` (e.g. `0.1.0` → `0.1.1`) and
   commit it to `main`:
   ```
   git commit -am "chore(release): v0.1.1"
   ```
3. Tag that commit and push the tag:
   ```
   git tag v0.1.1
   git push origin main --tags
   ```

Pushing the `v*.*.*` tag triggers `.github/workflows/release.yml`, which:

- re-runs the full gate (ESLint, typecheck/build, tests), then
- creates a GitHub Release for the tag with **auto-generated notes**
  (`gh release create --generate-notes`), diffing against the previous tag.

If the workflow fails _after_ the gate but before publishing, re-run it from the
Actions tab (**Run workflow** → enter the existing tag) — it's idempotent and
skips an already-created release.

## What users get

- **Default:** `install.sh` / `install.ps1` query the GitHub "latest release"
  API and install that tag. No release yet → they fall back to `main`.
- **Dev edge:** `--branch main` (or `-Branch main` on Windows) installs the tip
  of `main`.
- **Pin a version:** `--tag v0.1.0` (or `--branch v0.1.0`).

## Notes

- The release workflow needs no secrets — it uses the built-in `GITHUB_TOKEN`
  (`contents: write`).
- `git clone --branch <ref>` accepts both branches and tags, so the installer
  needs no special-casing to install a tag.
