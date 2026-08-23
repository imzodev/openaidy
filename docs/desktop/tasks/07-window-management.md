# Task 07: Window Management

## Objective

Implement proper desktop window controls: minimize, maximize/restore toggle, close (hides to tray), and the window decorations. Ensure the Solid.js app fills the window correctly with no extra chrome.

## Success Criteria

1. Window decorations match OS defaults (native title bar on macOS/Linux, custom or native on Windows)
2. Minimize, maximize, close buttons work correctly
3. Window is resizable with min size constraints (900×600)
4. Window is centered on first launch, remembers position on subsequent launches
5. Fullscreen toggle works (F11 or menu)
6. Close button hides to tray (not quit) unless it's the last window

## Reused Components

None — pure Tauri window configuration.

## Files to Modify

```
apps/desktop/src-tauri/tauri.conf.json    ← UPDATE: Window + security config
apps/desktop/src-tauri/src/window.rs       ← MODIFY: Add state persistence
apps/desktop/src-tauri/src/main.rs         ← MODIFY: Wire window state
```

## Implementation Steps

### Step 7.1: Configure tauri.conf.json Window Settings

Update `apps/desktop/src-tauri/tauri.conf.json` — replace the `app.windows` section:

```json
{
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "OpenAidy",
        "width": 1200,
        "height": 800,
        "minWidth": 900,
        "minHeight": 600,
        "resizable": true,
        "fullscreen": false,
        "center": true,
        "decorations": true,
        "transparent": false,
        "visible": true,
        "focus": true
      }
    ],
    "security": {
      "csp": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*"
    }
  }
}
```

**Key fields:**

| Field             | Value   | Purpose                                          |
| ----------------- | ------- | ------------------------------------------------ |
| `decorations`     | `true`  | Use OS-native window chrome (title bar, buttons) |
| `resizable`       | `true`  | Allow resize                                     |
| `minWidth/Height` | 900×600 | Prevent unusable sizes                           |
| `center`          | `true`  | Center on first launch                           |
| `focus`           | `true`  | Bring to front on startup                        |

### Step 7.2: Window State Persistence

Save and restore window position/size across sessions. Add to `apps/desktop/src-tauri/src/window.rs`:

```rust
//! Window state persistence — remember size/position across sessions.

use std::path::PathBuf;
use std::fs;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WindowState {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub is_maximized: bool,
}

impl WindowState {
    pub fn load(openaidy_home: &PathBuf) -> Option<WindowState> {
        let path = openaidy_home.join("window-state.json");
        let content = fs::read_to_string(path).ok()?;
        serde_json::from_str(&content).ok()
    }

    pub fn save(&self, openaidy_home: &PathBuf) -> std::io::Result<()> {
        fs::create_dir_all(openaidy_home)?;
        let path = openaidy_home.join("window-state.json");
        let content = serde_json::to_string_pretty(self)?;
        fs::write(path, content)
    }
}
```

Update `setup_close_to_tray` in `window.rs` to also save state on close:

```rust
use std::sync::OnceLock;
static OPENAIDY_HOME: OnceLock<PathBuf> = OnceLock::new();

pub fn set_openaidy_home(home: PathBuf) {
    OPENAIDY_HOME.set(home).ok();
}

pub fn setup_close_to_tray<R: Runtime>(app: &AppHandle<R>) -> Result<(), Box<dyn std::error::Error>> {
    let main_window = app
        .get_webview_window("main")
        .ok_or("Main window not found")?;

    main_window.on_window_event(move |event: &CloseRequestedEvent| {
        event.prevent();

        // Save window state before hiding
        if let Some(home) = OPENAIDY_HOME.get() {
            if let Ok(pos) = main_window.outer_position() {
                if let Ok(size) = main_window.outer_size() {
                    let is_max = main_window.is_maximized().unwrap_or(false);
                    let state = WindowState {
                        x: pos.x,
                        y: pos.y,
                        width: size.width,
                        height: size.height,
                        is_maximized: is_max,
                    };
                    let _ = state.save(home);
                }
            }
        }

        if let Some(window) = app.get_webview_window("main") {
            let _ = window.hide();
        }
    });

    Ok(())
}
```

### Step 7.3: Apply Saved Window State on Startup

In `main.rs`, before `tauri::Builder::default()`, restore window state:

```rust
// Load saved window state
let window_state = WindowState::load(&openaidy_home);

// Apply to main window after setup
// (done in setup() callback)
```

And in `setup()`:

```rust
.setup(|app| {
    tray::setup_tray(app)?;
    setup_close_to_tray(app.handle())?;

    // Restore window state if saved
    if let Some(state) = WindowState::load(&openaidy_home) {
        if let Some(window) = app.get_webview_window("main") {
            if !state.is_maximized {
                let _ = window.set_position(tauri::Position::Physical(
                    tauri::PhysicalPosition::new(state.x, state.y),
                ));
                let _ = window.set_size(tauri::Size::Physical(
                    tauri::PhysicalSize::new(state.width, state.height),
                ));
            } else {
                let _ = window.maximize();
            }
        }
    }

    // Set the openaidy_home for window state saving
    set_openaidy_home(openaidy_home.clone());

    Ok(())
})
```

### Step 7.4: Fullscreen Toggle Command

Add a command for the frontend to trigger fullscreen:

```rust
#[tauri::command]
pub fn toggle_fullscreen(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let is_fullscreen = window.is_fullscreen().unwrap_or(false);
        window.set_fullscreen(!is_fullscreen).map_err(|e| e.to_string())?;
    }
    Ok(())
}
```

### Step 7.5: Verify Window Behavior

| Test                   | Expected                                    |
| ---------------------- | ------------------------------------------- |
| Launch app             | Window centered, 1200×800, native title bar |
| Resize to 800×500      | Window respects min size, won't go smaller  |
| Close window           | Window hides, tray icon remains             |
| Click tray icon        | Window restores with saved position/size    |
| F11 or menu fullscreen | Fullscreen toggles                          |
| Second launch          | Window appears at last saved position       |

## Windows-Specific Notes

On Windows, if you want the close button to go to tray instead of quitting, the current approach (intercepting `CloseRequestedEvent`) is correct. The native Windows title bar buttons work without custom implementation.

## macOS-Specific Notes

- `decorations: true` uses the native macOS traffic light buttons
- Fullscreen button is part of macOS's green traffic light
- The menu bar is separate from the window — tray lives in the menu bar

## Risks & Mitigations

| Risk                                             | Mitigation                                                        |
| ------------------------------------------------ | ----------------------------------------------------------------- |
| Window opens off-screen (monitor disconnected)   | Check if position is within virtual screen bounds before applying |
| State file corrupted                             | Catch parse errors, fall back to defaults                         |
| Race: save on close while restart is in progress | Mutex on state file                                               |
| Restore fails on first launch                    | No state file yet — `load()` returns `None` gracefully            |
