# ============================================================================
# OpenAidy Installer for Windows
# ============================================================================
# Installs OpenAidy from the prebuilt npm package (@openaidy/app). No git
# clone, no source build — just Node + ripgrep, then `npm install -g`.
#
# Usage:
#   iex (irm https://openaidy.com/install.ps1)
#
# Or download and run with options:
#   .\install.ps1 -Version 0.2.1
#
# ============================================================================

param(
    # Specific @openaidy/app version to install; empty = latest.
    [string]$Version = "",
    # Tools directory (managed Node + ripgrep).
    [string]$InstallDir = "$env:LOCALAPPDATA\openaidy"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

try {
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
} catch { }

# Data root (config, state, credentials, logs). Matches the CLI's default
# (os.homedir()/.openaidy) so a later `openaidy` invocation with no env finds
# the same home.
$script:DataHome = "$env:USERPROFILE\.openaidy"

# Node version to provision. Must be >= 22.13 so Node's built-in `node:sqlite`
# (OpenAidy's SQLite driver) is available without the --experimental-sqlite flag.
$script:NodeVersion = "22.23.1"

# ============================================================================
# Helpers
# ============================================================================

function Log-Info    { param([string]$Message) Write-Host "[openaidy] $Message" -ForegroundColor Cyan }
function Log-Success { param([string]$Message) Write-Host "[openaidy] ✓ $Message" -ForegroundColor Green }
function Log-Warn    { param([string]$Message) Write-Host "[openaidy] ⚠ $Message" -ForegroundColor Yellow }
function Log-Error   { param([string]$Message) Write-Host "[openaidy] ✗ $Message" -ForegroundColor Red }

function New-TempFile {
    $tmp = [System.IO.Path]::GetTempPath()
    return Join-Path $tmp "openaidy-install-$(Get-Random).tmp"
}

# ============================================================================
# Node.js provisioning
# ============================================================================

function Install-Node {
    Log-Info "Installing Node.js $($script:NodeVersion) LTS..."

    $arch = $env:PROCESSOR_ARCHITECTURE
    $nodeArch = "x64"
    if ($arch -eq "ARM64") { $nodeArch = "arm64" }

    $v = $script:NodeVersion
    $url = "https://nodejs.org/dist/v$v/node-v$v-win-$nodeArch.zip"
    $zipPath = New-TempFile
    $nodePath = Join-Path $InstallDir "node"

    try {
        Log-Info "Downloading Node.js..."
        Invoke-WebRequest -Uri $url -OutFile $zipPath -UserAgent "OpenAidy/1.0" -TimeoutSec 120

        if (Test-Path $nodePath) { Remove-Item $nodePath -Recurse -Force }
        New-Item -ItemType Directory -Path $nodePath -Force | Out-Null

        Expand-Archive -Path $zipPath -DestinationPath $nodePath -Force
        Remove-Item $zipPath -ErrorAction SilentlyContinue

        # Find extracted folder and move contents up
        $extracted = Get-ChildItem -Path $nodePath -Directory | Select-Object -First 1
        if ($extracted) {
            Get-ChildItem -Path $extracted.FullName | Move-Item -Destination $nodePath -Force
            Remove-Item $extracted.FullName -Recurse -Force
        }

        $nodeExe = Join-Path $nodePath "node.exe"
        if (Test-Path $nodeExe) {
            $ver = & "$nodeExe" --version 2>$null
            Log-Success "Node.js $ver installed to $nodePath"

            # Add to user PATH (npm global bins land in this dir too).
            $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
            $binPath = $nodePath
            if ($userPath -notlike "*$binPath*") {
                [Environment]::SetEnvironmentVariable("Path", "$binPath;$userPath", "User")
            }
            $env:PATH = "$binPath;$env:PATH"

            return $true
        }
    } catch {
        Log-Error "Node installation failed: $_"
        Remove-Item $zipPath -ErrorAction SilentlyContinue
        Remove-Item $nodePath -Recurse -Force -ErrorAction SilentlyContinue
    }

    return $false
}

# OpenAidy's SQLite layer uses Node's built-in `node:sqlite`, available without
# a flag only on Node >= 22.13. A too-old system Node returns $false here so a
# managed copy is provisioned instead.
function Test-Node {
    $v = $null
    try { $v = node --version 2>$null } catch { }
    if (-not $v) { return $false }

    $m = [regex]::Match([string]$v, 'v(\d+)\.(\d+)\.')
    if (-not $m.Success) { return $false }
    $major = [int]$m.Groups[1].Value
    $minor = [int]$m.Groups[2].Value
    $adequate = ($major -ge 24) -or ($major -eq 22 -and $minor -ge 13)

    if ($adequate) {
        Log-Success "Node.js $v found"
        return $true
    }
    Log-Warn "Node.js $v is too old (need >= 22.13 for node:sqlite) — installing a managed copy..."
    return $false
}

# ============================================================================
# ripgrep provisioning
# ============================================================================
# Required by code_search / code_glob tools. Without it those tools fail at
# runtime with a clear install hint; the server itself boots fine.

function Install-Ripgrep {
    Log-Info "Installing ripgrep..."

    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        Log-Info "Installing ripgrep via winget..."
        winget install --id BurntSushi.ripgrep -e --silent --accept-package-agreements --accept-source-agreements 2>$null
        if (Get-Command rg -ErrorAction SilentlyContinue) {
            Log-Success "ripgrep installed via winget"
            return $true
        }
    }

    $choco = Get-Command choco -ErrorAction SilentlyContinue
    if ($choco) {
        Log-Info "Installing ripgrep via Chocolatey..."
        choco install ripgrep -y --no-progress 2>$null
        if (Get-Command rg -ErrorAction SilentlyContinue) {
            Log-Success "ripgrep installed via Chocolatey"
            return $true
        }
    }

    $scoop = Get-Command scoop -ErrorAction SilentlyContinue
    if ($scoop) {
        Log-Info "Installing ripgrep via Scoop..."
        scoop install ripgrep 2>$null
        if (Get-Command rg -ErrorAction SilentlyContinue) {
            Log-Success "ripgrep installed via Scoop"
            return $true
        }
    }

    # Last resort: download the official zip from GitHub releases and
    # drop rg.exe into $InstallDir\bin. No package manager required.
    $arch = $env:PROCESSOR_ARCHITECTURE
    $rgArch = if ($arch -eq "ARM64") { "aarch64-pc-windows-msvc" } else { "x86_64-pc-windows-msvc" }
    $url = "https://github.com/BurntSushi/ripgrep/releases/latest/download/ripgrep-$rgArch.zip"
    $zipPath = New-TempFile
    $binDir = Join-Path $InstallDir "bin"
    $rgExe = Join-Path $binDir "rg.exe"

    try {
        Log-Info "Downloading ripgrep from $url ..."
        Invoke-WebRequest -Uri $url -OutFile $zipPath -UserAgent "OpenAidy/1.0" -TimeoutSec 90

        if (-not (Test-Path $binDir)) {
            New-Item -ItemType Directory -Path $binDir -Force | Out-Null
        }

        $expandDir = Join-Path ([System.IO.Path]::GetTempPath()) ("openaidy-rg-" + [Guid]::NewGuid().ToString("N"))
        New-Item -ItemType Directory -Path $expandDir -Force | Out-Null
        Expand-Archive -Path $zipPath -DestinationPath $expandDir -Force

        $rgSource = Get-ChildItem -Path $expandDir -Recurse -Filter "rg.exe" | Select-Object -First 1
        if ($rgSource) {
            Move-Item -Path $rgSource.FullName -Destination $rgExe -Force
            Remove-Item -Path $expandDir -Recurse -Force -ErrorAction SilentlyContinue
            Remove-Item -Path $zipPath -ErrorAction SilentlyContinue

            $env:PATH = "$binDir;$env:PATH"
            Log-Success "ripgrep installed to $rgExe"
            return $true
        }

        Log-Error "rg.exe not found inside downloaded archive"
    } catch {
        Log-Error "ripgrep download failed: $_"
    }

    Remove-Item -Path $zipPath -ErrorAction SilentlyContinue
    Remove-Item -Path $expandDir -Recurse -Force -ErrorAction SilentlyContinue
    return $false
}

function Test-Ripgrep {
    $binDir = Join-Path $InstallDir "bin"
    $rgExe = Join-Path $binDir "rg.exe"
    if (Test-Path $rgExe) {
        $env:PATH = "$binDir;$env:PATH"
    }

    try {
        $v = rg --version 2>$null
        if ($v) {
            Log-Success "ripgrep found"
            return $true
        }
    } catch { }

    Log-Warn "ripgrep not found — required by code_search / code_glob"
    if (-not (Install-Ripgrep)) {
        Log-Error "Could not install ripgrep. Install manually from https://github.com/BurntSushi/ripgrep"
        return $false
    }
    return $true
}

# ============================================================================
# uv / uvx provisioning (Python-based MCP servers)
# ============================================================================
# Node-based MCP servers launch through `npx`, which the managed Node install
# above provides. Python-based ones launch through `uvx` — without it they fail
# to spawn at all (`spawn uvx ENOENT`), so a user who adds one has to install a
# toolchain by hand. Provision the toolchain here so those servers work as soon
# as the user adds one.
#
# Scope: the toolchain only. No MCP server package is installed here — which
# ones to run is the user's choice, made from the MCP page, and the installer
# must not put a third-party package on every box without that consent.

function Install-Uv {
    Log-Info "Installing uv (Python toolchain for MCP servers)..."

    $binDir = Join-Path $InstallDir "bin"
    if (-not (Test-Path $binDir)) {
        New-Item -ItemType Directory -Path $binDir -Force | Out-Null
    }

    try {
        # Official installer, pinned to the directory we already use for managed
        # tools. We add it to PATH ourselves (below), same as the Node step, so
        # the installer doesn't register a second location.
        $env:UV_INSTALL_DIR = $binDir
        $env:UV_NO_MODIFY_PATH = "1"
        Invoke-RestMethod https://astral.sh/uv/install.ps1 -UseBasicParsing | Invoke-Expression
    } catch {
        Log-Warn "Could not install uv: $_"
        Log-Info "Install it manually from https://docs.astral.sh/uv/getting-started/installation/"
        return $false
    } finally {
        Remove-Item Env:\UV_INSTALL_DIR -ErrorAction SilentlyContinue
        Remove-Item Env:\UV_NO_MODIFY_PATH -ErrorAction SilentlyContinue
    }

    if (-not (Test-Path (Join-Path $binDir "uvx.exe"))) {
        Log-Warn "uv installer finished but uvx.exe is not in $binDir"
        return $false
    }

    # Persist so a later `openaidy start` from a fresh terminal still finds uvx
    # when it spawns an MCP server (ripgrep lives in this dir too).
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($userPath -notlike "*$binDir*") {
        [Environment]::SetEnvironmentVariable("Path", "$binDir;$userPath", "User")
    }
    $env:PATH = "$binDir;$env:PATH"
    return $true
}

function Test-Uv {
    # Honor an OpenAidy-managed install from a previous run.
    $binDir = Join-Path $InstallDir "bin"
    if (Test-Path (Join-Path $binDir "uvx.exe")) {
        $env:PATH = "$binDir;$env:PATH"
    }

    if (Get-Command uvx -ErrorAction SilentlyContinue) {
        Log-Success "uv found"
        return
    }

    Log-Warn "uv not found — required by Python-based MCP servers"
    if (-not (Install-Uv)) { return }
    Log-Success "uv installed"
}

# ============================================================================
# OpenAidy CLI (prebuilt npm package)
# ============================================================================

function Install-OpenAidy {
    $spec = "@openaidy/app"
    if (-not [string]::IsNullOrWhiteSpace($Version)) {
        $spec = "@openaidy/app@" + ($Version -replace '^v', '')
    }
    Log-Info "Installing $spec from npm..."

    npm install -g $spec
    if ($LASTEXITCODE -ne 0) {
        Log-Error "Failed to install $spec"
        exit 1
    }

    # Locate the installed `openaidy` bin (npm places .cmd shims in the global
    # prefix root on Windows) and make sure that dir is on the user PATH.
    $npmPrefix = ""
    try { $npmPrefix = (& npm prefix -g).Trim() } catch { }
    $cmd = ""
    if ($npmPrefix -and (Test-Path (Join-Path $npmPrefix "openaidy.cmd"))) {
        $cmd = Join-Path $npmPrefix "openaidy.cmd"
        $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
        if ($userPath -notlike "*$npmPrefix*") {
            [Environment]::SetEnvironmentVariable("Path", "$npmPrefix;$userPath", "User")
        }
        $env:PATH = "$npmPrefix;$env:PATH"
    }
    $script:OpenAidyCmd = $cmd
    Log-Success "openaidy installed ($spec)"
}

# ============================================================================
# Bootstrap Admin Token
# ============================================================================

# 32-byte hex JWT secret, persisted under the data home so re-installs reuse it.
function New-JwtSecret {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($bytes)
    } finally {
        $rng.Dispose()
    }
    return ([BitConverter]::ToString($bytes) -replace '-', '').ToLower()
}

function Get-JwtSecret {
    $stateDir = Join-Path $script:DataHome "state"
    $manifestPath = Join-Path $stateDir "install.json"

    if (Test-Path $manifestPath) {
        try {
            $existing = Get-Content $manifestPath -Raw | ConvertFrom-Json
            if ($existing.wsTokenSecret) {
                Log-Info "Reusing JWT signing secret from $manifestPath — the bootstrap admin token will NOT be regenerated."
                return $existing.wsTokenSecret
            }
        } catch {
            # Manifest unreadable — fall through to regenerate
        }
    }

    if (-not (Test-Path $stateDir)) {
        New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
    }
    $newSecret = New-JwtSecret
    $obj = [PSCustomObject]@{
        wsTokenSecret = $newSecret
        generatedAt   = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    }
    $obj | ConvertTo-Json | Set-Content -Path $manifestPath -Encoding UTF8
    try {
        icacls $manifestPath /inheritance:r /grant:r "$env:USERNAME:(R,W)" 2>$null | Out-Null
    } catch { }

    Log-Info "Generated new JWT signing secret and persisted to $manifestPath."
    return $newSecret
}

function Invoke-Init {
    Log-Info "Generating bootstrap admin token..."

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $script:OpenAidyCmd
    $psi.Arguments = "init"
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.EnvironmentVariables["OPENAIDY_HOME"] = $script:DataHome
    $psi.EnvironmentVariables["WS_TOKEN_SECRET"] = $script:JwtSecret
    $psi.EnvironmentVariables["PATH"] = "$InstallDir\bin;$InstallDir\node;$env:PATH"

    $proc = [System.Diagnostics.Process]::Start($psi)
    $stdout = $proc.StandardOutput.ReadToEnd()
    $stderr = $proc.StandardError.ReadToEnd()
    $proc.WaitForExit()

    if ($proc.ExitCode -ne 0) {
        Log-Error "openaidy init failed (exit $($proc.ExitCode))"
        if ($stderr) { Write-Host $stderr }
        exit 1
    }

    $match = [regex]::Match($stdout, '(?m)^Bootstrap admin token:\s+(.+?)\s*$')
    if (-not $match.Success) {
        Log-Error "openaidy init succeeded but no token line was printed"
        Write-Host $stdout
        exit 1
    }
    return $match.Groups[1].Value
}

# ============================================================================
# Main
# ============================================================================

Write-Host ""
Write-Host "OpenAidy Installer" -ForegroundColor White
Write-Host ""

Log-Info "Tools directory: $InstallDir"
Log-Info "Home directory:  $script:DataHome"
Write-Host ""

# Node
if (-not (Test-Node)) {
    if (-not (Install-Node)) {
        Log-Error "Could not install Node.js. Install Node.js 22 manually from https://nodejs.org"
        exit 1
    }
}

# ripgrep
if (-not (Test-Ripgrep)) {
    exit 1
}

# uv / uvx + Python MCP server environments (non-fatal: only Python-based MCP
# servers depend on it, the server itself boots fine without it).
Test-Uv

# OpenAidy CLI (prebuilt package)
Install-OpenAidy
if ([string]::IsNullOrWhiteSpace($script:OpenAidyCmd)) {
    Log-Error "openaidy was installed but its command could not be located on PATH."
    Log-Error "Open a new terminal and run 'openaidy start'."
    exit 1
}

# Ensure JWT secret + generate bootstrap-admin token (idempotent).
$script:JwtSecret = Get-JwtSecret
$env:OPENAIDY_HOME = $script:DataHome
$env:WS_TOKEN_SECRET = $script:JwtSecret
$BootstrapToken = Invoke-Init

# Start the server and open the browser. The packaged server serves the web UI
# itself on one port, so plain `openaidy start` needs no flags (no Vite).
#
# We must NOT use `2>&1`: under $ErrorActionPreference='Stop', PowerShell 5.1
# turns any stderr line from the native command into a terminating
# NativeCommandError and aborts the installer before we can read the exit code.
# Let stderr flow to the console, and wrap defensively so a flaky start still
# falls through to the "did not start" guidance instead of crashing.
Write-Host ""
Log-Info "Starting the server (this may take up to 30 seconds)..."
$StartOutput = ""
$StartExit = 1
try {
    $env:OPENAIDY_HOME = $script:DataHome
    $StartOutput = & $script:OpenAidyCmd start
    $StartExit = $LASTEXITCODE
} catch {
    $StartExit = 1
    $StartOutput = "$_"
}
$StartUrl = ""
if ($StartExit -eq 0) {
    $StartUrl = [regex]::Match($StartOutput, 'http://localhost:\d+').Value
    Log-Info "Server is ready."
} else {
    Log-Warn "Server did not start (will be available after re-login)."
}

Write-Host ""
Log-Success "OpenAidy is installed."
Write-Host ""
Write-Host "Bootstrap admin token: $BootstrapToken"
Write-Host ""

if ($StartUrl) {
    # Deep-link the browser straight into the login screen with the token
    # pre-filled, so the user only has to press "Connect".
    $EncodedToken = [uri]::EscapeDataString($BootstrapToken)
    $AuthUrl = "${StartUrl}/?token=${EncodedToken}"
    Write-Host "Server is running at: $StartUrl"
    Write-Host "Login URL (token pre-filled): $AuthUrl"
    Write-Host ""
    try {
        Start-Process $AuthUrl
    } catch {
        Write-Host "Open $AuthUrl in your browser."
    }
    Write-Host ""
    Write-Host "Use 'openaidy stop' to stop the server."
} else {
    $EncodedToken = [uri]::EscapeDataString($BootstrapToken)
    $AuthUrl = "http://localhost:3001/?token=${EncodedToken}"
    Write-Host "Open a new terminal and run 'openaidy start' to bring the server online,"
    Write-Host "then open $AuthUrl in your browser."
    Write-Host ""
    Write-Host "If it still doesn't start, check the log at:"
    Write-Host "  $script:DataHome\logs\server.log"
}
Write-Host ""
