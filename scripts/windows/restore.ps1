param(
    [Parameter(Mandatory = $true)]
    [string]$BackupDirectory
)

$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
. (Join-Path $PSScriptRoot "NodeRuntime.ps1")

Invoke-ProjectLocalRunner -ProjectRoot $projectRoot -Command "restore" -CommandArguments @($BackupDirectory)
exit 0
