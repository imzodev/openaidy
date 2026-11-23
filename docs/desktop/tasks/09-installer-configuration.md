# Task 09: Installer Configuration

## Objective

Configure the Tauri bundler to produce installers for all three platforms from a single codebase. The installer should set up the app, register the background service (if selected), and create desktop/launcher shortcuts.

## Success Criteria

1. `pnpm tauri build` produces `.deb`, `.dmg`, `.exe`/`.msi` from the same code
2. Each installer includes proper app metadata (name, version, icon, description)
3. Installers register file associations (`.aidy` project files)
4. Uninstaller cleanly removes service + app + config (user data optional)
5. Code signing is configured (with placeholder certs for now)

## Reused Components

None — pure Tauri bundler configuration.

## Files to Modify

```
apps/desktop/src-tauri/tauri.conf.json           ← UPDATE: Full bundle config
apps/desktop/src-tauri/bundle/                   ← NEW: Per-OS configs
apps/desktop/scripts/aidy-service.sh         ← MODIFY: Better wrapper
```

## Implementation Steps

### Step 9.1: Complete tauri.conf.json Bundle Section

Update the `bundle` section in `apps/desktop/src-tauri/tauri.conf.json`:

```json
{
  "productName": "Aidy",
  "version": "0.1.0",
  "identifier": "app.aidyagent",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:5173",
    "beforeDevCommand": "pnpm dev",
    "beforeBuildCommand": "pnpm --filter web build",
    "devtools": true
  },
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "Aidy",
        "width": 1200,
        "height": 800,
        "minWidth": 900,
        "minHeight": 600,
        "resizable": true,
        "center": true,
        "decorations": true,
        "focus": true
      }
    ],
    "security": {
      "csp": "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*; img-src 'self' data: https:;"
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ],
    "resources": ["scripts/aidy-service.sh"],
    "category": "Productivity",
    "shortDescription": "AI Assistant Desktop App",
    "longDescription": "Aidy is a desktop AI assistant that provides agent management, session handling, and extensible addons.",
    "copyright": "Copyright © 2024",
    "publisher": "Aidy",
    "certificateChain": "bundle/certs/cert.pem",
    "signingIdentity": null,
    "windows": {
      "nsis": {
        "installMode": "currentUser",
        "installerIcon": "icons/icon.ico",
        "headerImage": "bundle/windows/header.bmp",
        "sidebarImage": "bundle/windows/sidebar.bmp",
        "languages": ["English", "Spanish", "Portuguese"],
        "displayLanguageSelector": true
      },
      "wix": {
        "language": ["en-US", "es-ES", "pt-BR"]
      }
    },
    "macOS": {
      "minimumSystemVersion": "10.15",
      "frameworks": [],
      "minimumDeploymentTarget": "10.15",
      "signingIdentity": "-",
      "providerShortName": "Aidy",
      "entitlements": "bundle/macos/entitlements.plist"
    },
    "linux": {
      "appimage": {
        "bundleMediaFramework": false
      },
      "deb": {
        "depends": ["libwebkit2gtk-4.1-0", "libsecret-1-0"]
      },
      "rpm": {
        "release": "1"
      }
    }
  },
  "plugins": {
    "shell": {
      "open": true
    }
  }
}
```

### Step 9.2: NSIS Installer (Windows) — Service Registration

The NSIS installer runs custom scripts during install/uninstall. Configure the service registration:

Create `apps/desktop/src-tauri/bundle/windows/installer.nsi`:

```nsis
!macro customInstall
  ; Install the service wrapper script
  File /nonfatal "scripts\aidy-service.bat"

  ; Create config directory
  CreateDirectory "$APPDATA\aidy"

  ; Write a default .env file pointing to sqlite
  FileOpen $0 "$APPDATA\aidy\.env" w
  FileWrite $0 "DB_KIND=sqlite$\r$\n"
  FileWrite $0 "AIDY_HOME=$APPDATA\aidy$\r$\n"
  FileClose $0

  ; Register scheduled task for auto-start
  nsExec::ExecToLog 'schtasks /Create /TN Aidy /TR "$INSTDIR\aidy-service.bat" /SC ONLOGON /F'
!macroend

!macro customUnInstall
  ; Remove scheduled task
  nsExec::ExecToLog 'schtasks /Delete /TN Aidy /F'

  ; Optionally remove user data (ask first)
  MessageBox MB_YESNO "Remove Aidy data and settings?" IDNO +2
    RMDir /r "$APPDATA\aidy"
!macroend
```

### Step 9.3: macOS Entitlements

Create `apps/desktop/src-tauri/bundle/macos/entitlements.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.app-sandbox</key>
  <false/>
  <key>com.apple.security.network.client</key>
  <true/>
  <key>com.apple.security.files.user-selected.read-write</key>
  <true/>
  <key>keychain-access-groups</key>
  <array>
    <string>$(AppIdentifierPrefix)app.aidyagent</string>
  </array>
</dict>
</plist>
```

Note: The `keychain-access-groups` is for the app's own keychain entries. The actual keychain access for API keys uses the `security-framework` crate which doesn't require sandbox entitlements.

### Step 9.4: Linux Debian Dependencies

Create `apps/desktop/src-tauri/bundle/linux/debian/control`:

```
Package: aidy
Version: 0.1.0
Section: utils
Priority: optional
Maintainer: Aidy <support@aidyagent.app>
Architecture: amd64
Depends: libwebkit2gtk-4.1-0 (>= 2.40), libsecret-1-0 (>= 0.18), nodejs (>= 18)
Description: Desktop AI Assistant
 Aidy is a desktop AI assistant providing agent management,
 session handling, and an extensible addon system.
```

### Step 9.5: Update beforeBuildCommand

The `beforeBuildCommand` must build the `apps/web` frontend before bundling:

```bash
# In tauri.conf.json "build.beforeBuildCommand"
"pnpm --filter web build"
```

This ensures `apps/web/dist` is populated before Tauri tries to bundle `frontendDist: "../dist"`.

### Step 9.6: Install the App

After build, copy the service wrapper to a system PATH location:

Create `apps/desktop/scripts/aidy-service.sh` (Linux/macOS):

```bash
#!/usr/bin/env bash
set -e

AIDY_HOME="${AIDY_HOME:-$HOME/.config/aidy}"
export AIDY_HOME

# Load environment
if [ -f "$AIDY_HOME/.env" ]; then
  set -a
  source "$AIDY_HOME/.env"
  set +a
fi

# Find the server
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/../../../apps/server/dist/index.js" ]; then
  SERVER="$SCRIPT_DIR/../../../apps/server/dist/index.js"
  RUNNER="node"
else
  SERVER="$SCRIPT_DIR/../../../apps/server/src/server.ts"
  RUNNER="tsx"
fi

exec $RUNNER "$SERVER"
```

Make it executable:

```bash
chmod +x apps/desktop/scripts/aidy-service.sh
```

### Step 9.7: Build Outputs

After `pnpm tauri build`:

```
apps/desktop/src-tauri/target/release/bundle/
├── deb/
│   └── aidy_0.1.0_amd64.deb          (~10MB)
├── msi/
│   └── aidy_0.1.0_x64_en-US.msi      (~12MB)
├── dmg/
│   └── aidy_0.1.0.dmg                (~15MB)
├── appimage/
│   └── aidy_0.1.0_amd64.AppImage    (~12MB)
└── rpm/
    └── aidy-0.1.0-1.x86_64.rpm
```

### Step 9.8: Code Signing (Placeholder)

Before shipping, the installers should be signed:

**macOS:**

```bash
# Developer ID Application certificate required
codesign --sign "Developer ID Application: Your Name" aidy.dmg
```

**Windows:**

```bash
# Code signing certificate required
signtool sign /f certificate.pfx /p password aidy.msi
```

**Linux:**

- `.deb` packages can be signed with `debsigs`
- `.AppImage` can be signed with `gpg --sign`

For now, these are placeholders in `tauri.conf.json`.

## Verification

| Test                                        | Expected                                |
| ------------------------------------------- | --------------------------------------- |
| `pnpm tauri build` completes without errors | All 4 platform bundles produced         |
| Install `.deb` on Ubuntu                    | App appears in app grid, service starts |
| Install `.dmg` on macOS                     | App in Applications, tray icon appears  |
| Install `.exe` on Windows                   | App in Start Menu, runs without prompt  |
| Uninstall each                              | App + service removed cleanly           |

## Risks & Mitigations

| Risk                                             | Mitigation                                  |
| ------------------------------------------------ | ------------------------------------------- |
| libwebkit2gtk not available on all Linux distros | Document required deps in README            |
| NSIS custom script errors                        | Test install/uninstall in VM                |
| macOS Gatekeeper blocks unsigned `.dmg`          | Document how to allow in System Preferences |
| Windows SmartScreen blocks unsigned `.exe`       | Encourage code signing before release       |
| AppImage won't run without WebKit                | `libwebkit2gtk` is a hard dependency        |
