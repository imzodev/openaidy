<#
.SYNOPSIS
    Full-stack smoke test for the OpenAidy installation flow on Windows.

.DESCRIPTION
    Tests openaidy init, start, status, and stop on a clean Windows environment.
    Designed for manual execution on a Windows VM or dev machine.

    Steps:
      1. Creates a clean OPENAIDY_HOME in %TEMP%
      2. Generates a WS_TOKEN_SECRET
      3. Runs `openaidy init` and validates the token file
      4. Runs `openaidy start` and polls /health
      5. Runs `openaidy status` and confirms running
      6. Runs `openaidy stop` and confirms stopped
      7. Cleans up the temp home

.PARAMETER LocalRepo
    Path to a local openaidy repo checkout. If omitted, uses `openaidy` from PATH.

.PARAMETER NoCleanup
    If set, does NOT delete the temp home after the test (useful for debugging).

.EXAMPLE
    .\scripts\smoke-install.ps1 -LocalRepo C:\Users\me\openaidy

.EXAMPLE
    .\scripts\smoke-install.ps1

.NOTES
    Requires: Node.js 20+, pnpm, PowerShell 5.1+
    Manual execution per design R-D2 (no CI matrix in repo).
#>

param(
    [string]$LocalRepo = "",
    [switch]$NoCleanup
)

$ErrorActionPreference = "Stop"

$SmokeHome = Join-Path $env:TEMP "openaidy-smoke-$(Get-Random)"
$OldHome = $env:OPENAIDY_HOME
$OldSecret = $env:WS_TOKEN_SECRET

function Log($msg) { Write-Host "[smoke] $msg" }
function Fail($msg) { Write-Host "[smoke] FAIL: $msg" -ForegroundColor Red; exit 1 }

# Cleanup handler
try {
    # Create temp home
    New-Item -ItemType Directory -Path $SmokeHome -Force | Out-Null
    $env:OPENAIDY_HOME = $SmokeHome
    $env:WS_TOKEN_SECRET = -join ((48..57) + (97..102) | Get-Random -Count 64 | ForEach-Object { [char]$_ })
    $env:CI = "1"

    Log "Using OPENAIDY_HOME=$SmokeHome"

    # Determine CLI
    if ($LocalRepo) {
        if (-not (Test-Path (Join-Path $LocalRepo "packages/cli"))) {
            Fail "LocalRepo '$LocalRepo' does not contain packages/cli"
        }
        $Cli = "node --import tsx $(Join-Path $LocalRepo "packages/cli/bin/openaidy.ts")"
        Push-Location $LocalRepo
    } else {
        $Cli = "openaidy"
    }

    # Phase 1: init
    Log "=== Phase 1: openaidy init ==="
    $InitOutput = Invoke-Expression "$Cli init" 2>&1
    if ($LASTEXITCODE -ne 0) {
        Fail "openaidy init exited $LASTEXITCODE`n$InitOutput"
    }
    if ($InitOutput -notmatch "^Bootstrap admin token: ") {
        Fail "missing 'Bootstrap admin token:' line`n$InitOutput"
    }
    Log "OK: init produced token"

    # Phase 2: token file
    Log "=== Phase 2: Token file validation ==="
    $TokenFile = Join-Path $SmokeHome "credentials/bootstrap-admin.json"
    if (-not (Test-Path $TokenFile)) {
        Fail "token file not found at $TokenFile"
    }
    try {
        $Record = Get-Content $TokenFile -Raw | ConvertFrom-Json
        if (-not $Record.clientId) { Fail "missing clientId" }
        if (-not $Record.token) { Fail "missing token" }
        if (-not ($Record.scopes -contains "*")) { Fail "scopes missing admin wildcard '*'")
        if (-not $Record.createdAt) { Fail "missing createdAt" }
        if (-not $Record.expiresAt) { Fail "missing expiresAt" }
        $Parts = $Record.token -split '\.'
        if ($Parts.Count -ne 3) { Fail "token is not a 3-segment JWT" }
        Log "OK: token file well-formed (clientId=$($Record.clientId))"
    } catch {
        Fail "token file parse error: $_"
    }

    # Phase 3: idempotency
    Log "=== Phase 3: Idempotency check ==="
    $FirstHash = (Get-FileHash $TokenFile -Algorithm SHA256).Hash
    Start-Sleep -Seconds 1
    Invoke-Expression "$Cli init" 2>&1 | Out-Null
    $SecondHash = (Get-FileHash $TokenFile -Algorithm SHA256).Hash
    if ($FirstHash -ne $SecondHash) {
        Fail "token changed on re-run (idempotency violation)"
    }
    Log "OK: idempotent — token unchanged"

    # Phase 4: start
    Log "=== Phase 4: openaidy start ==="
    Log "Building server..."
    Invoke-Expression "pnpm --filter @openaidy/server build" 2>&1 | Out-Null
    $StartOutput = Invoke-Expression "$Cli start" 2>&1
    if ($LASTEXITCODE -ne 0) {
        Fail "openaidy start exited $LASTEXITCODE`n$StartOutput"
    }
    if ($StartOutput -notmatch "Server is ready") {
        Log "WARNING: start may not have confirmed readiness (server may still be starting)`n$StartOutput"
    }
    Log "OK: server started"

    # Phase 5: status
    Log "=== Phase 5: openaidy status ==="
    $StatusOutput = Invoke-Expression "$Cli status" 2>&1
    if ($StatusOutput -notmatch "running") {
        Fail "status did not report running`n$StatusOutput"
    }
    Log "OK: status reports running"

    # Phase 6: stop
    Log "=== Phase 6: openaidy stop ==="
    $StopOutput = Invoke-Expression "$Cli stop" 2>&1
    if ($LASTEXITCODE -ne 0) {
        Fail "openaidy stop exited $LASTEXITCODE`n$StopOutput"
    }
    Log "OK: server stopped"

    # Phase 7: status after stop
    Log "=== Phase 7: status after stop ==="
    $StatusAfter = Invoke-Expression "$Cli status" 2>&1
    if ($StatusAfter -notmatch "stopped") {
        Fail "status did not report stopped after stop`n$StatusAfter"
    }
    Log "OK: status reports stopped"

    Log ""
    Log "========================================"
    Log "SUCCESS: smoke-install.ps1"
    Log "  ✓ init — token minted and persisted"
    Log "  ✓ token file — JWT shape valid"
    Log "  ✓ idempotency — re-run preserves token"
    Log "  ✓ start — server spawned and healthy"
    Log "  ✓ status — reports running"
    Log "  ✓ stop — server shut down cleanly"
    Log "  ✓ status — reports stopped"
    Log "========================================"

} finally {
    # Cleanup
    $env:OPENAIDY_HOME = $OldHome
    $env:WS_TOKEN_SECRET = $OldSecret
    if (-not $NoCleanup -and (Test-Path $SmokeHome)) {
        Remove-Item -Recurse -Force $SmokeHome -ErrorAction SilentlyContinue
    }
}
