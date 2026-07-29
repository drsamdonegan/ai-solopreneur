$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
. (Join-Path $PSScriptRoot "NodeRuntime.ps1")

$nodePath = Resolve-ProjectNode -ProjectRoot $projectRoot -Install
$env:Path = "$(Split-Path -Parent $nodePath);$env:Path"

& $nodePath (Join-Path $projectRoot "scripts\evaluate-pilot.mjs") @args
exit $LASTEXITCODE
