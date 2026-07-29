$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
. (Join-Path $PSScriptRoot "NodeRuntime.ps1")

Invoke-ProjectLocalRunner -ProjectRoot $projectRoot -Command "sync-skills" -CommandArguments $args
exit 0
