$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
. (Join-Path $PSScriptRoot "NodeRuntime.ps1")

Invoke-ProjectLocalRunner -ProjectRoot $projectRoot -Command "export-workflows" -CommandArguments $args
exit 0
