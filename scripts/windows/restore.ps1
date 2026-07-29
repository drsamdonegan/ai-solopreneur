param(
    [Parameter(Mandatory = $true)]
    [string]$BackupDirectory,
    [switch]$Yes
)

$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
. (Join-Path $PSScriptRoot "NodeRuntime.ps1")

$commandArguments = @($BackupDirectory)
if ($Yes) {
    $commandArguments += "--yes"
}

Invoke-ProjectLocalRunner -ProjectRoot $projectRoot -Command "restore" -CommandArguments $commandArguments
exit 0
