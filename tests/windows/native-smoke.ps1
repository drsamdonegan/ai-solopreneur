$ErrorActionPreference = "Stop"

$sourceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$testRoot = Join-Path $env:RUNNER_TEMP "AI Solopreneur Windows Smoke"

function Invoke-Launcher {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [string[]]$Arguments = @(),
        [int[]]$ExpectedStatus = @(0)
    )

    $launcher = Join-Path $testRoot $Name
    $quotedArguments = $Arguments | ForEach-Object {
        '"' + $_.Replace('"', '""') + '"'
    }
    $commandLine = 'call "' + $launcher + '"'
    if ($quotedArguments.Count -gt 0) {
        $commandLine += " " + ($quotedArguments -join " ")
    }

    $output = New-Object "System.Collections.Generic.List[string]"
    $nativeStatus = 0
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        # Windows PowerShell 5.1 wraps native stderr as non-terminating
        # NativeCommandError records. Keep streaming those records instead of
        # allowing the test's global Stop policy to discard the real message.
        $ErrorActionPreference = "Continue"
        & $env:ComSpec /d /s /c $commandLine 2>&1 | ForEach-Object {
            $line = [string]$_
            Write-Host $line
            $output.Add($line)
        }
        $nativeStatus = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    $status = $nativeStatus
    if ($status -notin $ExpectedStatus) {
        throw "$Name exited with $status; expected $($ExpectedStatus -join ' or ')."
    }
    return [PSCustomObject]@{
        Status = $status
        Output = ($output -join "`n")
    }
}

if (Test-Path -LiteralPath $testRoot) {
    Remove-Item -LiteralPath $testRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $testRoot | Out-Null

$null = & robocopy.exe `
    $sourceRoot `
    $testRoot `
    /E `
    /XD .git .runtime node_modules data backups instructor-pack `
    /NFL /NDL /NJH /NJS /NC /NS
if ($LASTEXITCODE -ge 8) {
    throw "Could not create the isolated Windows smoke-test copy (robocopy exit $LASTEXITCODE)."
}

$env:AI_SOLO_NO_PAUSE = "1"
$env:NODE_ENV = "production"
$env:NPM_CONFIG_OMIT = "dev optional"
$env:NPM_CONFIG_IGNORE_SCRIPTS = "true"
$env:NPM_CONFIG_BIN_LINKS = "false"
$env:NPM_CONFIG_LOGLEVEL = "error"

Set-Location $testRoot

try {
    & powershell.exe `
        -NoProfile `
        -ExecutionPolicy Bypass `
        -File (Join-Path $testRoot "tests\windows\node-runtime.tests.ps1")
    if ($LASTEXITCODE -ne 0) {
        throw "Windows Node.js runtime contract tests failed."
    }

    $setup = Invoke-Launcher -Name "setup-windows.cmd"
    if ($setup.Output -notmatch "Local stack is healthy") {
        throw "The real setup launcher did not report a healthy stack."
    }

    # The setup cmd.exe process has exited. Resolve the same private runtime in
    # this new PowerShell process and prove the detached services survived it.
    . (Join-Path $testRoot "scripts\windows\NodeRuntime.ps1")
    $nodePath = Resolve-ProjectNode -ProjectRoot $testRoot
    $npmCli = Join-Path (Split-Path -Parent $nodePath) "node_modules\npm\bin\npm-cli.js"
    if ((& $nodePath --version) -ne "v24.18.0") {
        throw "The Windows smoke did not select Node.js 24.18.0."
    }
    if ((& $nodePath -p "process.arch") -ne "x64") {
        throw "The Windows smoke did not select the x64 compatibility runtime."
    }
    if ((& $nodePath $npmCli --version) -ne "11.16.0") {
        throw "The Windows smoke did not select npm 11.16.0."
    }
    & $nodePath -e "require('sqlite3'); require('isolated-vm')"
    if ($LASTEXITCODE -ne 0) {
        throw "Required Windows native modules did not load."
    }
    & $nodePath scripts\local.mjs status
    if ($LASTEXITCODE -ne 0) {
        throw "Detached services were not healthy after the setup window exited."
    }

    $diagnose = Invoke-Launcher -Name "diagnose-windows.cmd" -ExpectedStatus @(1)
    if ($diagnose.Output -notmatch "\[next\]") {
        throw "Fresh Windows diagnostics did not identify the expected credential/publish actions."
    }

    $null = Invoke-Launcher -Name "stop-windows.cmd"
    $null = Invoke-Launcher -Name "preflight-windows.cmd"
    $null = Invoke-Launcher -Name "start-windows.cmd"

    $chatHealth = Invoke-WebRequest `
        -Uri "http://127.0.0.1:3000/health" `
        -UseBasicParsing `
        -TimeoutSec 20
    if ($chatHealth.StatusCode -ne 200) {
        throw "Chat health failed after the real stop/start launchers."
    }

    $null = Invoke-Launcher -Name "backup-windows.cmd"
    $backup = Get-ChildItem (Join-Path $testRoot "backups") -Directory |
        Sort-Object Name -Descending |
        Select-Object -First 1
    if (-not $backup) {
        throw "The Windows backup launcher did not create a backup."
    }

    $null = Invoke-Launcher -Name "reset-windows.cmd" -Arguments @("--yes")
    $null = Invoke-Launcher `
        -Name "restore-windows.cmd" `
        -Arguments @("-BackupDirectory", $backup.FullName, "-Yes")
    $null = Invoke-Launcher -Name "sync-skills-windows.cmd"
    $null = Invoke-Launcher -Name "export-workflows-windows.cmd"

    $packRoot = Join-Path $env:RUNNER_TEMP "AI Solo Windows Pack"
    if (Test-Path -LiteralPath $packRoot) {
        Remove-Item -LiteralPath $packRoot -Recurse -Force
    }
    $null = Invoke-Launcher `
        -Name "prepare-instructor-pack-windows.cmd" `
        -Arguments @("-MetadataOnly", "-OutputRoot", $packRoot)
    if (-not (Test-Path -LiteralPath (Join-Path $packRoot "v0.2.0-metadata-test\SHA256SUMS"))) {
        throw "The Windows PowerShell 5.1 instructor-pack smoke did not create checksums."
    }

    Write-Host "Windows learner-path smoke passed."
} finally {
    try {
        $null = Invoke-Launcher -Name "stop-windows.cmd"
    } catch {
        Write-Warning $_
    }
    Set-Location $sourceRoot
}
