$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
. (Join-Path $projectRoot "scripts\windows\NodeRuntime.ps1")

function Assert-True {
    param(
        [Parameter(Mandatory = $true)][bool]$Condition,
        [Parameter(Mandatory = $true)][string]$Message
    )
    if (-not $Condition) {
        throw $Message
    }
}

Assert-True `
    (Test-ProjectNodeCompatibility -Version "24.18.0" -Architecture "x64" -ExpectedVersion "24.18.0") `
    "The reviewed x64 Node.js runtime should be accepted."
Assert-True `
    (-not (Test-ProjectNodeCompatibility -Version "25.2.1" -Architecture "x64" -ExpectedVersion "24.18.0")) `
    "Node.js 25 must not be selected for Node.js 24 native modules."
Assert-True `
    (-not (Test-ProjectNodeCompatibility -Version "24.18.0" -Architecture "arm64" -ExpectedVersion "24.18.0")) `
    "Native Windows ARM64 Node.js must not be selected for x64-only n8n modules."
Assert-True `
    ((Get-ProjectNodePlatform) -eq "x64") `
    "Both supported Windows processor paths must select the reviewed x64 runtime."
Assert-True `
    ((Get-ExpectedNodeChecksum -Architecture "x64") -eq "0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821") `
    "The reviewed Windows x64 checksum changed unexpectedly."

$rejectedSystemNode = Get-SystemNode24 `
    -ExpectedVersion "0.0.0" `
    -ExpectedNpmVersion "0.0.0"
Assert-True `
    ($null -eq $rejectedSystemNode) `
    "An unreviewed system Node.js/npm pair must fall back to the private runtime."

Write-Host "Windows Node.js runtime contract tests passed."
