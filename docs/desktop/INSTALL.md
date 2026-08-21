# Installing the OpenAidy Desktop App

The desktop app is a native window (Windows/macOS/Linux) that bundles OpenAidy's
own server and starts it for you — no terminal, no `openaidy start`. It's built
from this repo via [Tauri](https://tauri.app/) and published alongside every
tagged release.

## Download

Grab the installer for your OS from the [Releases page](https://github.com/imzodev/openaidy/releases/latest):

| OS      | File                                                          |
| ------- | ------------------------------------------------------------- |
| Windows | `OpenAidy_*_x64-setup.exe`                                    |
| macOS   | `OpenAidy_*_universal.dmg` (Intel and Apple Silicon)          |
| Linux   | `.deb`, `.rpm`, or `.AppImage`, whichever matches your distro |

## First run

The app starts its own copy of the OpenAidy server in the background, then
opens the login screen with an admin token already filled in — press
**Connect** and you're in. All data lives in your OS's per-user app-data
directory (e.g. `%APPDATA%\openaidy` on Windows, `~/.local/share/openaidy` on
Linux, `~/Library/Application Support/openaidy` on macOS), the same as the CLI
install.

## Requirements

- **Linux**: Node.js 18+ must already be on your system — the `.deb`/`.rpm`
  packages declare this as a dependency, but the `.AppImage` doesn't enforce
  it, so install Node yourself first if you're using that format.
- **Windows / macOS**: nothing extra — the installer bundles everything else
  it needs.

## A note on the current (unsigned) builds

These installers aren't code-signed yet, so your OS will warn you before
first launch:

- **Windows**: SmartScreen will say "Windows protected your PC" — click
  **More info** → **Run anyway**.
- **macOS**: Gatekeeper will refuse to open it from a double-click. Instead,
  right-click (or Control-click) the app in Finder and choose **Open**, then
  confirm in the dialog that appears. You only need to do this once.
- **Linux**: no equivalent warning; `.deb`/`.rpm`/`.AppImage` all run
  normally.

This is expected for now — proper code signing (a paid Windows cert and an
Apple Developer ID) is tracked as follow-up work, not a sign anything is
wrong with the build.

## Updating

The app checks for a newer release once per launch. If one's available, a
small **Update available — install & restart** link appears next to the
desktop status indicator; clicking it downloads, installs, and relaunches
automatically. If you'd rather do it manually, downloading the latest
installer from the [Releases page](https://github.com/imzodev/openaidy/releases/latest)
and running it over your existing install works too — your data isn't
touched either way.
