# ============================================================================
# OpenAidy Installer for Windows
# ============================================================================
#
# Usage:
#   iex (irm https://openaidy.dev/install.ps1)
#
# Or download and run with options:
#   .\install.ps1 -Branch feat/x -SkipBuild
#
# ============================================================================

param(
    [string]$Branch = "main",
    [string]$InstallDir = "$env:LOCALAPPDATA\openaidy",
    [switch]$SkipBuild,
    [switch]$SkipSetup,
    [switch]$NonInteractive
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

try {
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
} catch { }

# ============================================================================
# Helpers
# ============================================================================

function Log-Info    { Write-Host "[openaidy] $($args[0])" -ForegroundColor Cyan }
function Log-Success { Write-Host "[openaidy] ✓ $($args[0])" -ForegroundColor Green }
function Log-Warn    { Write-Host "[openaidy] ⚠ $($args[0])" -ForegroundColor Yellow }
function Log-Error   { Write-Host "[openaidy] ✗ $($args[0])" -ForegroundColor Red }

function New-TempFile {
    $tmp = [System.IO.Path]::GetTempPath()
    return Join-Path $tmp "openaidy-install-$(Get-Random).tmp"
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

    if (Test-Path $pnpmBin -or Test-Path $pnpmFallback) {
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
# Repository
# ============================================================================

function Clone-Repo {
    param([string]$Branch)

    Log-Info "Cloning repository (branch: $Branch)..."

    if (Test-Path (Join-Path $InstallDir ".git")) {
        Log-Info "Repository exists — updating..."
        Set-Location $InstallDir
        git fetch origin $Branch 2>$null
        git checkout $Branch 2>$null
        git reset --hard "origin/$Branch" 2>$null
    } else {
        $parent = Split-Path $InstallDir
        if ($parent -and -not (Test-Path $parent)) {
            New-Item -ItemType Directory -Path $parent -Force | Out-Null
        }

        $repoUrl = "https://github.com/imzodev/openaidy.git"
        Log-Info "Cloning from $repoUrl..."
        git clone --branch $Branch --depth 1 $repoUrl $InstallDir 2>$null
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
    pnpm install --frozen-lockfile 2>$null 2>&1 | Out-Null

    Log-Info "Building project..."
    pnpm build 2>&1 | Out-Null

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

    $cliContent = "@echo off`r`n" +
        "set OPENAIDY_HOME=$InstallDir`r`n" +
        "set PATH=%OPENAIDY_HOME%\node;%OPENAIDY_HOME%\pnpm;%PATH%`r`n" +
        "if exist `"%OPENAIDY_HOME%\packages\cli\bin\openaidy.ts`" (`r`n" +
        "  node --import tsx `"%OPENAIDY_HOME%\packages\cli\bin\openaidy.ts`" %*`r`n" +
        ") else (`r`n" +
        "  echo OpenAidy not found at %OPENAIDY_HOME%`r`n" +
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
# Main
# ============================================================================

Write-Host ""
Write-Host "OpenAidy Installer" -ForegroundColor White
Write-Host ""

Log-Info "Install directory: $InstallDir"
Log-Info "Branch: $Branch"
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

Write-Host ""
Log-Success "OpenAidy is installed!"
Write-Host ""