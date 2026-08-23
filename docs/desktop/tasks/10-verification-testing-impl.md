# Desktop App Verification & Testing Strategy

> **Task:** 10-verification-testing  
> **Status:** Implemented

## Overview

Comprehensive testing strategy for the OpenAidy desktop app covering integration tests, smoke tests, performance benchmarks, and security verification.

## Test Categories

```
Desktop App Tests
├── Smoke Tests
│   ├── App launches without crash
│   ├── Service starts and binds to port
│   └── WebView renders Solid.js app
├── Integration Tests
│   ├── Agent invocation end-to-end
│   ├── Session persistence across restarts
│   ├── Addon loading in WebView
│   └── Credential storage/retrieval
├── Platform Tests
│   ├── Linux: systemd service lifecycle
│   ├── macOS: LaunchAgent + Keychain
│   └── Windows: Service registration
├── Performance Tests
│   ├── Cold startup time < 3s
│   ├── Memory usage < 200MB idle
│   └── Service restart < 5s
└── Security Tests
    ├── Keychain: credentials not in plaintext
    ├── CSP: no external network from WebView
    └── Service: runs as non-root user
```

## Automated Smoke Tests

Located at `apps/desktop/smoke.test.ts` using Vitest.

Run with:

```bash
cd apps/desktop && pnpm test
# or with watch mode
pnpm test:watch
```

### Current Test Coverage

- `ServiceStatus` structure validation
- Port range validation (1-65535)
- Credential storage/retrieval mock tests
- `isDesktop` flag verification
- ServiceState enum value validation

## Manual Verification Checklist

### Phase 1: Core Service

| #   | Test                         | Command/Action                      | Expected                         |
| --- | ---------------------------- | ----------------------------------- | -------------------------------- |
| 1.1 | Server starts on random port | Run `apps/server` with `PORT=0`     | Binds to a free port, logs it    |
| 1.2 | Server reads OPENAIDY_HOME   | Set `OPENAIDY_HOME=/tmp/test`       | Uses `/tmp/test` for `.openaidy` |
| 1.3 | SQLite database created      | Run with fresh `OPENAIDY_HOME`      | `openaidy.db` created            |
| 1.4 | CORS origin enforced         | CORS_ORIGIN=app://0.0.0.0           | Browser requests blocked         |
| 1.5 | Health endpoint responds     | `curl http://localhost:PORT/health` | `200 OK`                         |

### Phase 2: Tauri Shell

| #   | Test                          | Command/Action         | Expected                              |
| --- | ----------------------------- | ---------------------- | ------------------------------------- | -------------------- |
| 2.1 | `tauri dev` launches window   | Run `pnpm tauri dev`   | Window opens, shows Solid.js          |
| 2.2 | WebView connects to service   | DevTools network tab   | API calls to `127.0.0.1:PORT` succeed |
| 2.3 | Service spawns as subprocess  | Check `ps aux          | grep server`                          | Node process appears |
| 2.4 | Service stdout logged         | Check Tauri logs       | Server logs visible                   |
| 2.5 | `tauri build` produces bundle | Run `pnpm tauri build` | `.exe`/`.app`/`.deb` created          |

### Phase 3: Service Manager

| #   | Test                      | Command/Action                               | Expected                           |
| --- | ------------------------- | -------------------------------------------- | ---------------------------------- |
| 3.1 | Service restarts on crash | Kill the server process                      | Restarted within 5s, max 3 times   |
| 3.2 | Port file updated         | After restart, `cat ~/.config/openaidy/port` | New port written                   |
| 3.3 | Graceful shutdown         | Click Quit in tray                           | SIGTERM sent, server exits cleanly |
| 3.4 | SIGKILL after timeout     | Server ignores SIGTERM 10s                   | SIGKILL applied after timeout      |
| 3.5 | `get_service_status` IPC  | Call from frontend                           | Returns correct state/port         |

### Phase 4: Credential Storage

| #   | Test                           | Command/Action                              | Expected                                  |
| --- | ------------------------------ | ------------------------------------------- | ----------------------------------------- |
| 4.1 | Store credential               | Call `store_credential("openai", "sk-...")` | Value in Keychain (check with `security`) |
| 4.2 | Retrieve credential            | Call `get_credential("openai")`             | Returns `sk-...`                          |
| 4.3 | Delete credential              | Call `delete_credential("openai")`          | Removed from Keychain                     |
| 4.4 | Credentials injected to server | Check env of server subprocess              | API keys present as env vars              |
| 4.5 | Keychain survives restart      | Store, quit app, relaunch                   | Credential still retrievable              |

### Phase 5: IPC Bridge

| #   | Test                         | Command/Action             | Expected                          |
| --- | ---------------------------- | -------------------------- | --------------------------------- |
| 5.1 | `isDesktop` flag             | Check in browser vs Tauri  | `true` only in Tauri              |
| 5.2 | Service status polling       | Frontend polls every 5s    | Status bar updates                |
| 5.3 | Service restart from UI      | Click restart button       | Service restarts, port may change |
| 5.4 | `getApiBase()` resolves port | Check `fetch()` URL        | Uses `127.0.0.1:PORT`             |
| 5.5 | Graceful fallback in browser | Open `apps/web` in browser | Uses `localhost:3001`, no crash   |

### Phase 6: System Tray

| #   | Test                  | Command/Action        | Expected                      |
| --- | --------------------- | --------------------- | ----------------------------- |
| 6.1 | Tray icon appears     | Launch app            | Icon visible in system tray   |
| 6.2 | Left-click tray       | Click tray icon       | Window shows and focuses      |
| 6.3 | Right-click tray menu | Right-click tray      | Menu: "Open OpenAidy", "Quit" |
| 6.4 | Open from tray        | Click "Open OpenAidy" | Window appears                |
| 6.5 | Quit from tray        | Click "Quit"          | App + service exit            |

### Phase 7: Window Management

| #   | Test                     | Command/Action               | Expected                        |
| --- | ------------------------ | ---------------------------- | ------------------------------- |
| 7.1 | Minimize button          | Click minimize               | Window hides to taskbar         |
| 7.2 | Maximize button          | Click maximize               | Window fills screen             |
| 7.3 | Restore                  | Click maximize again         | Window returns to original size |
| 7.4 | Close → tray             | Click close                  | Window hides, app in tray       |
| 7.5 | Window state persistence | Move/resize, close, relaunch | Position restored               |

### Phase 8: Service Installation

| #   | Test                          | Command/Action                     | Expected                           |
| --- | ----------------------------- | ---------------------------------- | ---------------------------------- |
| 8.1 | Linux: systemd install        | `systemctl --user enable openaidy` | Service enabled                    |
| 8.2 | Linux: service starts on boot | Reboot                             | Service running on login           |
| 8.3 | macOS: LaunchAgent install    | `launchctl load` plist             | Service active in `launchctl list` |
| 8.4 | macOS: runs on login          | Log out + in                       | App appears in menu bar            |
| 8.5 | Windows: task registered      | `schtasks /Query /TN OpenAidy`     | Task exists                        |
| 8.6 | Uninstall removes service     | Uninstall app                      | Service/task removed               |

### Phase 9: Addon System

| #   | Test                     | Command/Action                   | Expected                           |
| --- | ------------------------ | -------------------------------- | ---------------------------------- |
| 9.1 | Addon bundles served     | GET `/addons/<id>/dist/index.js` | Returns JS bundle                  |
| 9.2 | `AddonLoader` in WebView | Load app with addon installed    | Sidebar shows addon entry          |
| 9.3 | Addon routes work        | Navigate to addon route          | Component renders                  |
| 9.4 | Addon proxy auth         | Addon makes API call             | JWT validated, permissions checked |

### Phase 10: Installers

| #    | Test                        | Command/Action         | Expected                      |
| ---- | --------------------------- | ---------------------- | ----------------------------- |
| 10.1 | `.deb` install              | `dpkg -i openaidy.deb` | Installs, icon appears        |
| 10.2 | `.dmg` drag to Applications | Copy to Applications   | App launches                  |
| 10.3 | `.exe`/`.msi` install       | Run installer          | App installs to Program Files |
| 10.4 | Uninstaller works           | `dpkg -r openaidy`     | App removed cleanly           |
| 10.5 | App runs after install      | Launch from app grid   | Full functionality            |

## Performance Benchmarks

| Metric                      | Target  | Measurement                             |
| --------------------------- | ------- | --------------------------------------- |
| Cold startup (Tauri window) | < 3s    | Time from launch to window visible      |
| Cold startup (service)      | < 2s    | Time from spawn to port bound           |
| Restart after crash         | < 5s    | Time from crash to new server listening |
| Memory (idle)               | < 200MB | Resident set size of combined process   |
| Binary size (desktop)       | < 20MB  | Download size of installer              |
| WebView load time           | < 1s    | Time to first paint after window open   |

Measure with:

```bash
# Startup time
time openaidy  # from install

# Memory
ps aux | grep openaidy | awk '{print $6}'  # RSS in KB
```

## Security Verification

| Test                           | Method                                        | Expected                        |
| ------------------------------ | --------------------------------------------- | ------------------------------- | ----------------- |
| API keys not in plaintext      | Check `~/.config/openaidy/.env` after storing | Only `OPENAIDY_HOME`, no keys   |
| CSP blocks external requests   | Network tab in DevTools                       | No requests outside `127.0.0.1` |
| Server runs as non-root        | `ps aux                                       | grep server`                    | No root processes |
| Keychain entries scoped to app | `security list-keychains`                     | `openaidy` keychain only        |
| No secrets in binary           | `strings openaidy-desktop \| grep sk-`        | Empty                           |

## Risks & Known Issues

| Issue                              | Workaround                              |
| ---------------------------------- | --------------------------------------- |
| WebView2 not installed on Windows  | Bundle WebView2 in installer            |
| `libsecret` missing on Linux       | Document as install dependency          |
| Tauri dev server proxy not working | Verify `vite.config.ts` proxy config    |
| macOS notarization fails           | Use `tauri build --ci` with bypass flag |

## Files Created/Modified

- `apps/desktop/smoke.test.ts` - Automated smoke tests
- `apps/desktop/vitest.config.ts` - Vitest configuration
- `apps/desktop/package.json` - Added vitest as devDependency and test scripts
