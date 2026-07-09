# ============================================================================
# OpenAidy Installer for Windows
# ============================================================================
#
# Usage:
#   iex (irm https://openaidy.com/install.ps1)
#
# Or download and run with options:
#   .\install.ps1 -Branch feat/x -SkipBuild
#
# ============================================================================

param(
    # Empty = auto: resolve the latest published release tag (falling back to
    # 'main' when no release exists yet). Pass -Branch main for the dev edge,
    # or -Branch v0.1.0 for a specific release.
    [string]$Branch = "",
    [string]$InstallDir = "$env:LOCALAPPDATA\openaidy",
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

try {
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
} catch { }

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

# Query the newest published release tag via the GitHub API. Returns the tag
# (e.g. "v0.1.0"), or "main" when there's no release yet / the API is
# unreachable — so a fresh repo with no releases still installs.
function Resolve-DefaultRef {
    try {
        $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/imzodev/openaidy/releases/latest" `
            -Headers @{ "User-Agent" = "OpenAidy-Installer" } -TimeoutSec 15
        if ($rel.tag_name) { return $rel.tag_name }
    } catch { }
    return "main"
}

# ============================================================================
# Git provisioning
# ============================================================================

function Install-Git {
    Log-Info "Git not found — installing..."

    # Try winget
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        Log-Info "Installing Git via winget..."
        winget install --id Git.Git -e --silent --accept-package-agreements --accept-source-agreements 2>$null
        if (Get-Command git -ErrorAction SilentlyContinue) {
            Log-Success "Git installed via winget"
            return $true
        }
    }

    # Try choco
    $choco = Get-Command choco -ErrorAction SilentlyContinue
    if ($choco) {
        Log-Info "Installing Git via Chocolatey..."
        choco install git -y 2>$null
        if (Get-Command git -ErrorAction SilentlyContinue) {
            Log-Success "Git installed via Chocolatey"
            return $true
        }
    }

    # Direct download as last resort
    Log-Info "Downloading Portable Git..."
    $url = "https://github.com/git-for-windows/git/releases/download/v2.47.0.windows.1/MinGit-2.47.0-64-bit.zip"
    $zipPath = New-TempFile
    $installPath = Join-Path $env:LOCALAPPDATA "Git"
    $exePath = Join-Path $installPath "cmd\git.exe"

    try {
        Invoke-WebRequest -Uri $url -OutFile $zipPath -UserAgent "OpenAidy/1.0" -TimeoutSec 60
        Expand-Archive -Path $zipPath -DestinationPath $installPath -Force
        Remove-Item $zipPath -ErrorAction SilentlyContinue

        $gitBin = Join-Path $installPath "cmd"
        $env:PATH = "$gitBin;$env:PATH"

        if (Test-Path $exePath) {
            Log-Success "Git installed to $installPath"
            return $true
        }
    } catch {
        Remove-Item $zipPath -ErrorAction SilentlyContinue
    }

    return $false
}

function Test-Git {
    try {
        $v = git --version 2>$null
        if ($v) {
            Log-Success "Git $($v.Split(' ')[2]) found"
            return $true
        }
    } catch { }
    return $false
}

# ============================================================================
# Node.js provisioning
# ============================================================================

function Install-Node {
    Log-Info "Installing Node.js 22 LTS..."

    $arch = $env:PROCESSOR_ARCHITECTURE
    $nodeArch = "x64"
    if ($arch -eq "ARM64") { $nodeArch = "arm64" }

    $url = "https://nodejs.org/dist/latest-v22.x/node-v22.12.0-win-$nodeArch.zip"
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

            # Add to user PATH
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

function Test-Node {
    try {
        $v = node --version 2>$null
        if ($v) {
            Log-Success "Node.js $v found"
            return $true
        }
    } catch { }
    return $false
}

# ============================================================================
# pnpm provisioning
# ============================================================================

function Install-Pnpm {
    Log-Info "Installing pnpm..."

    $pnpmHome = Join-Path $InstallDir "pnpm"
    $pnpmBin = Join-Path $pnpmHome "pnpm.exe"
    $pnpmFallback = Join-Path $pnpmHome "bin\pnpm.exe"

    if ((Test-Path $pnpmBin) -or (Test-Path $pnpmFallback)) {
        $ver = & $pnpmBin --version 2>$null
        Log-Success "pnpm $ver found"
        $env:PNPM_HOME = $pnpmHome
        $env:PATH = "$pnpmHome;$env:PATH"
        return $true
    }

    try {
        # Use npm to install pnpm globally
        $env:PNPM_HOME = $pnpmHome
        New-Item -ItemType Directory -Path $pnpmHome -Force | Out-Null

        $npmExe = Join-Path (Split-Path (Get-Command node).Source) "npm.exe"
        if (Test-Path $npmExe) {
            $proc = Start-Process -FilePath $npmExe -ArgumentList "install","-g","pnpm" -PassThru -NoWindow -RedirectStandardOutput (New-TempFile) -RedirectStandardError (New-TempFile)
            $proc.WaitForExit()

            $pnpmCli = Join-Path $env:APPDATA "npm\pnpm.cmd"
            if (Test-Path $pnpmCli) {
                Copy-Item $pnpmCli $pnpmBin -Force
                $ver = & $pnpmBin --version 2>$null
                Log-Success "pnpm $ver installed"
                return $true
            }
        }
    } catch {
        Log-Warn "pnpm install via npm failed"
    }

    # Direct install via pnpm installer script
    try {
        $installScript = Join-Path $pnpmHome "install.ps1"
        New-Item -ItemType Directory -Path $pnpmHome -Force | Out-Null
        Invoke-WebRequest -Uri "https://get.pnpm.io/install.ps1" -OutFile $installScript -UserAgent "OpenAidy/1.0" -TimeoutSec 30
        $env:PNPM_HOME = $pnpmHome
        $env:PATH = "$pnpmHome;$env:PATH"
        Invoke-Expression "powershell -ExecutionPolicy Bypass -File $installScript"
        Remove-Item $installScript -ErrorAction SilentlyContinue

        if (Test-Path $pnpmBin) {
            $ver = & $pnpmBin --version 2>$null
            Log-Success "pnpm $ver installed"
            return $true
        }
    } catch {
        Log-Warn "pnpm direct install failed: $_"
    }

    return $false
}

function Test-Pnpm {
    try {
        $v = pnpm --version 2>$null
        if ($v) {
            Log-Success "pnpm $v found"
            return $true
        }
    } catch { }
    return $false
}

# ============================================================================
# ripgrep provisioning
# ============================================================================
# Required by code_search / code_glob tools. Without it those tools fail at
# runtime with a clear install hint; the server itself boots fine.

function Install-Ripgrep {
    Log-Info "Installing ripgrep..."

    # Try winget first
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        Log-Info "Installing ripgrep via winget..."
        winget install --id BurntSushi.ripgrep -e --silent --accept-package-agreements --accept-source-agreements 2>$null
        if (Get-Command rg -ErrorAction SilentlyContinue) {
            Log-Success "ripgrep installed via winget"
            return $true
        }
    }

    # Then Chocolatey
    $choco = Get-Command choco -ErrorAction SilentlyContinue
    if ($choco) {
        Log-Info "Installing ripgrep via Chocolatey..."
        choco install ripgrep -y --no-progress 2>$null
        if (Get-Command rg -ErrorAction SilentlyContinue) {
            Log-Success "ripgrep installed via Chocolatey"
            return $true
        }
    }

    # Then Scoop
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

        # The zip ships as ripgrep-<ver>-<arch>/rg.exe — expand into a
        # throwaway dir then move the binary into $binDir.
        $expandDir = Join-Path ([System.IO.Path]::GetTempPath()) ("openaidy-rg-" + [Guid]::NewGuid().ToString("N"))
        New-Item -ItemType Directory -Path $expandDir -Force | Out-Null
        Expand-Archive -Path $zipPath -DestinationPath $expandDir -Force

        $rgSource = Get-ChildItem -Path $expandDir -Recurse -Filter "rg.exe" | Select-Object -First 1
        if ($rgSource) {
            Move-Item -Path $rgSource.FullName -Destination $rgExe -Force
            Remove-Item -Path $expandDir -Recurse -Force -ErrorAction SilentlyContinue
            Remove-Item -Path $zipPath -ErrorAction SilentlyContinue

            # Surface the OpenAidy-managed binary on PATH for subsequent steps.
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
    # Honor a previously-installed OpenAidy-managed binary.
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
# Repository
# ============================================================================

function Clone-Repo {
    param([string]$Branch)

    Log-Info "Cloning repository (branch: $Branch)..."

    if (Test-Path (Join-Path $InstallDir ".git")) {
        Log-Info "Repository exists — updating..."
        Set-Location $InstallDir
        git fetch origin $Branch 2>&1 | Out-Null
        git checkout $Branch 2>&1 | Out-Null
        git reset --hard "origin/$Branch" 2>&1 | Out-Null
    } else {
        $parent = Split-Path $InstallDir
        if ($parent -and -not (Test-Path $parent)) {
            New-Item -ItemType Directory -Path $parent -Force | Out-Null
        }

        $repoUrl = "https://github.com/imzodev/openaidy.git"
        Log-Info "Cloning from $repoUrl..."
        git clone --branch $Branch --depth 1 --quiet $repoUrl $InstallDir 2>&1 | Out-Null
    }

    if (Test-Path (Join-Path $InstallDir "package.json")) {
        Log-Success "Repository ready at $InstallDir"
        return $true
    } else {
        Log-Error "Repository setup failed"
        return $false
    }
}

# ============================================================================
# Build
# ============================================================================

function Build-Project {
    if ($SkipBuild) {
        Log-Info "Skipping build (-SkipBuild)"
        return $true
    }

    Set-Location $InstallDir

    $pnpmHome = Join-Path $InstallDir "pnpm"
    $env:PNPM_HOME = $pnpmHome
    $env:PATH = "$pnpmHome;$env:PATH"

    Log-Info "Installing dependencies..."
    pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) {
        Log-Info "Frozen lockfile failed — retrying with regular install..."
        pnpm install
        if ($LASTEXITCODE -ne 0) {
            Log-Error "Dependency installation failed"
            exit 1
        }
    }

    Log-Info "Building project..."
    pnpm build
    if ($LASTEXITCODE -ne 0) {
        Log-Error "Build failed"
        exit 1
    }

    Log-Success "Build complete"
    return $true
}

# ============================================================================
# CLI
# ============================================================================

function Install-Cli {
    $binDir = Join-Path $env:LOCALAPPDATA "openaidy\bin"
    if (-not (Test-Path $binDir)) {
        New-Item -ItemType Directory -Path $binDir -Force | Out-Null
    }

    $cliPath = Join-Path $binDir "openaidy.cmd"

    # OPENAIDY_HOME = data root (tokens, PID, logs) in user's home dir.
    # OPENAIDY_REPO = code root (repo clone) used by `start` to resolve server entry.
    $dataDir = "$env:USERPROFILE\.openaidy"
    $cliContent = "@echo off`r`n" +
        "set OPENAIDY_HOME=$dataDir`r`n" +
        "set OPENAIDY_REPO=$InstallDir`r`n" +
        "set PATH=%OPENAIDY_REPO%\bin;%OPENAIDY_REPO%\node;%OPENAIDY_REPO%\pnpm;%PATH%`r`n" +
        "cd /d `"%OPENAIDY_REPO%`"`r`n" +
        "if exist `"%OPENAIDY_REPO%\packages\cli\bin\openaidy.ts`" (`r`n" +
        "  node --import tsx `"%OPENAIDY_REPO%\packages\cli\bin\openaidy.ts`" %*`r`n" +
        ") else (`r`n" +
        "  echo OpenAidy not found at %OPENAIDY_REPO%`r`n" +
        "  exit /b 1`r`n" +
        ")"

    [System.IO.File]::WriteAllText($cliPath, $cliContent)

    # Add to user PATH
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($userPath -notlike "*$binDir*") {
        [Environment]::SetEnvironmentVariable("Path", "$binDir;$userPath", "User")
    }

    Log-Success "CLI installed to $cliPath"
    Log-Info "Run: openaidy --help"
}

# ============================================================================
# Bootstrap Admin Token (PR1)
# ============================================================================

# Generate a 32-byte hex JWT secret. Persisted at $env:LOCALAPPDATA\openaidy\state\install.json
# so subsequent installs reuse it (idempotency per CC-7).
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
    $stateDir = Join-Path $InstallDir "state"
    $manifestPath = Join-Path $stateDir "install.json"

    if (Test-Path $manifestPath) {
        try {
            $existing = Get-Content $manifestPath -Raw | ConvertFrom-Json
            if ($existing.wsTokenSecret) {
                return $existing.wsTokenSecret
            }
        } catch {
            # Manifest unreadable — fall through to regenerate
        }
    }

    # Generate and persist
    if (-not (Test-Path $stateDir)) {
        New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
    }
    $newSecret = New-JwtSecret
    $obj = [PSCustomObject]@{
        wsTokenSecret = $newSecret
        generatedAt   = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    }
    $obj | ConvertTo-Json | Set-Content -Path $manifestPath -Encoding UTF8
    # Tighten ACL on the manifest (Windows best-effort)
    try {
        icacls $manifestPath /inheritance:r /grant:r "$env:USERNAME:(R,W)" 2>$null | Out-Null
    } catch { }

    return $newSecret
}

function Invoke-Init {
    Log-Info "Generating bootstrap admin token..."
    $binDir = Join-Path $env:LOCALAPPDATA "openaidy\bin"
    $cliPath = Join-Path $binDir "openaidy.cmd"

    # Call the wrapper. Output capture requires cmd's stdout, so use Process.
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $cliPath
    $psi.Arguments = "init"
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.EnvironmentVariables["OPENAIDY_HOME"] = "$env:USERPROFILE\.openaidy"
    $psi.EnvironmentVariables["OPENAIDY_REPO"] = $InstallDir
    $psi.EnvironmentVariables["WS_TOKEN_SECRET"] = $script:JwtSecret
    $psi.EnvironmentVariables["PATH"] = "$InstallDir\node;$InstallDir\pnpm;$env:PATH"

    $proc = [System.Diagnostics.Process]::Start($psi)
    $stdout = $proc.StandardOutput.ReadToEnd()
    $stderr = $proc.StandardError.ReadToEnd()
    $proc.WaitForExit()

    if ($proc.ExitCode -ne 0) {
        Log-Error "openaidy init failed (exit $($proc.ExitCode))"
        if ($stderr) { Write-Host $stderr }
        exit 1
    }

    # Parse `Bootstrap admin token: <jwt>` from stdout
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

Log-Info "Install directory: $InstallDir"
if ([string]::IsNullOrWhiteSpace($Branch)) {
    Log-Info "Resolving latest release..."
    $Branch = Resolve-DefaultRef
    if ($Branch -eq "main") {
        Log-Warn "No published release found — installing from 'main' (development edge)."
    } else {
        Log-Success "Latest release: $Branch"
    }
} else {
    Log-Info "Installing ref: $Branch (explicit)"
}
Write-Host ""

# Git
if (-not (Test-Git)) {
    if (-not (Install-Git)) {
        Log-Error "Could not install Git. Install Git manually from https://git-scm.com"
        exit 1
    }
}

# Node
if (-not (Test-Node)) {
    if (-not (Install-Node)) {
        Log-Error "Could not install Node.js. Install Node.js 22 manually from https://nodejs.org"
        exit 1
    }
}

# pnpm
if (-not (Test-Pnpm)) {
    Install-Pnpm
}

# ripgrep
if (-not (Test-Ripgrep)) {
    exit 1
}

# Repo
if (-not (Clone-Repo -Branch $Branch)) {
    exit 1
}

# Build
if (-not (Build-Project)) {
    Log-Error "Build failed"
    exit 1
}

# CLI
Install-Cli

# PR1: ensure JWT secret + generate bootstrap-admin token (idempotent).
$script:JwtSecret = Get-JwtSecret
$env:OPENAIDY_HOME = "$env:USERPROFILE\.openaidy"
$env:OPENAIDY_REPO = $InstallDir
$env:WS_TOKEN_SECRET = $script:JwtSecret
$BootstrapToken = Invoke-Init

# PR2: start the server and open the browser.
#
# --server-only: the server serves the already-built web bundle itself
# (apps/web/dist, resolved via the OPENAIDY_REPO fallback), so the whole UI is
# available on the server's port. We deliberately do NOT spawn the Vite dev
# server — it's a development tool, redundant for an installed instance, and a
# flaky Vite start shouldn't fail the install.
Write-Host ""
Log-Info "Starting the server (this may take up to 30 seconds)..."
$StartOutput = & "$env:LOCALAPPDATA\openaidy\bin\openaidy.cmd" start --server-only 2>&1
$StartExit = $LASTEXITCODE
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
    Write-Host "Server is running at: $StartUrl"
    Write-Host ""
    # Auto-open browser (best-effort per NDQ-4)
    try {
        Start-Process $StartUrl
    } catch {
        Write-Host "Open $StartUrl in your browser."
    }
    Write-Host ""
    Write-Host "Use 'openaidy stop' to stop the server."
} else {
    Write-Host "Run 'openaidy start --server-only' to bring the server online,"
    Write-Host "then open http://localhost:3001 in your browser."
    Write-Host ""
    Write-Host "If it still doesn't start, check the log at:"
    Write-Host "  $env:USERPROFILE\.openaidy\logs\server.log"
}
Write-Host ""